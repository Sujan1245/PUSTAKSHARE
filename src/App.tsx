import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Book as BookIcon, 
  Search, 
  User as UserIcon, 
  Plus, 
  LogOut, 
  Heart,
  MessageCircle,
  Bell,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Library
} from 'lucide-react';
import { auth, signInWithGoogle, logout, db, handleFirestoreError, OperationType } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  serverTimestamp,
  addDoc,
  updateDoc,
  orderBy
} from 'firebase/firestore';
import { UserProfile, Book, BorrowRequest, RequestStatus, BookStatus } from './types';
import { cn } from './lib/utils';
import { formatDistanceToNow } from 'date-fns';

// Views
type View = 'discover' | 'my-books' | 'requests' | 'profile';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('discover');
  
  // App state
  const [books, setBooks] = useState<Book[]>([]);
  const [myRequests, setMyRequests] = useState<BorrowRequest[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<BorrowRequest[]>([]);

  // Modals state
  const [isAddingBook, setIsAddingBook] = useState(false);
  const [borrowingBook, setBorrowingBook] = useState<Book | null>(null);

  // Logic functions
  async function addNewBook(bookData: Partial<Book>) {
    if (!user || !profile) return;
    try {
      const bRef = collection(db, 'books');
      await addDoc(bRef, {
        ...bookData,
        ownerId: user.uid,
        ownerName: profile.displayName,
        availabilityStatus: 'Available',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      // Increment user stats
      const uRef = doc(db, 'users', user.uid);
      const uSnap = await getDoc(uRef); 
      if (uSnap.exists()) {
        await updateDoc(uRef, {
          booksOffered: (uSnap.data().booksOffered || 0) + 1
        });
      }
      setIsAddingBook(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'books');
    }
  }

  async function updateBookStatus(id: string, status: BookStatus) {
    try {
      const bRef = doc(db, 'books', id);
      await updateDoc(bRef, { 
        availabilityStatus: status,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `books/${id}`);
    }
  }

  async function handleBorrowRequest(book: Book) {
    setBorrowingBook(book);
  }

  async function createRequest(book: Book, message: string) {
    if (!user || !profile) return;
    try {
      const rRef = collection(db, 'requests');
      await addDoc(rRef, {
        bookId: book.id,
        bookTitle: book.title,
        lenderId: book.ownerId,
        borrowerId: user.uid,
        borrowerName: profile.displayName,
        message,
        status: 'Pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setBorrowingBook(null);
      setView('requests');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'requests');
    }
  }

  async function handleRequestAction(request: BorrowRequest, status: RequestStatus) {
    try {
      const rRef = doc(db, 'requests', request.id);
      await updateDoc(rRef, { 
        status,
        updatedAt: serverTimestamp() 
      });

      // If accepted, mark book as borrowed
      if (status === 'Accepted') {
        const bRef = doc(db, 'books', request.bookId);
        await updateDoc(bRef, { availabilityStatus: 'Borrowed' });
        
        // Update borrower stats
        const uRef = doc(db, 'users', request.borrowerId);
        const uSnap = await getDoc(uRef);
        if (uSnap.exists()) {
           await updateDoc(uRef, { booksBorrowed: (uSnap.data().booksBorrowed || 0) + 1 });
        }
      }

      // If returned, mark book as available
      if (status === 'Returned') {
        const bRef = doc(db, 'books', request.bookId);
        await updateDoc(bRef, { availabilityStatus: 'Available' });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `requests/${request.id}`);
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Fetch or create profile
        const pRef = doc(db, 'users', u.uid);
        try {
          const pSnap = await getDoc(pRef);
          if (pSnap.exists()) {
            setProfile(pSnap.data() as UserProfile);
          } else {
            const newProfile: UserProfile = {
              uid: u.uid,
              displayName: u.displayName || 'Community Member',
              email: u.email || '',
              photoURL: u.photoURL || undefined,
              booksOffered: 0,
              booksBorrowed: 0,
              createdAt: serverTimestamp(),
            };
            await setDoc(pRef, newProfile);
            setProfile(newProfile);
          }
        } catch (err) {
          console.error("Error handling user profile", err);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Sync Books
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'books'), where('availabilityStatus', '!=', 'Hidden'), orderBy('availabilityStatus'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const bList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Book));
      setBooks(bList);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'books'));

    return () => unsubscribe();
  }, [user]);

  // Sync Requests (Outgoing)
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'requests'), where('borrowerId', '==', user.uid), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMyRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BorrowRequest)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'requests'));

    return () => unsubscribe();
  }, [user]);

  // Sync Requests (Incoming)
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'requests'), where('lenderId', '==', user.uid), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setIncomingRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BorrowRequest)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'requests'));

    return () => unsubscribe();
  }, [user]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <motion.div 
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
        >
          <BookIcon className="w-12 h-12 text-olive" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-warm-off-white flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="space-y-2">
            <div className="flex justify-center">
              <div className="bg-olive p-4 rounded-3xl shadow-xl">
                <Library className="w-12 h-12 text-white" />
              </div>
            </div>
            <h1 className="text-4xl font-serif font-bold text-stone-900 pt-4">PustakShare</h1>
            <p className="text-stone-600 font-medium">Build your community's library, one book at a time.</p>
          </div>
          
          <button 
            onClick={signInWithGoogle}
            className="w-full bg-white text-stone-800 px-8 py-4 rounded-full shadow-lg border border-stone-200 font-semibold flex items-center justify-center gap-3 hover:bg-stone-50 transition-all active:scale-95"
          >
            <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
            Continue with Google
          </button>
          
          <p className="text-xs text-stone-400 max-w-[280px] mx-auto">
            By joining, you agree to share books respectfully within your chosen community context.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-warm-off-white pb-24 md:pb-0 md:pl-64">
      {/* Sidebar Navigation (Desktop) */}
      <aside className="hidden md:flex fixed left-0 top-0 h-full w-64 bg-white border-r border-stone-200 p-6 flex-col justify-between">
        <div className="space-y-8">
          <div className="flex items-center gap-3">
            <div className="bg-olive p-2 rounded-xl">
              <Library className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-serif font-bold italic">PustakShare</span>
          </div>

          <nav className="space-y-2">
            <NavItem 
              active={view === 'discover'} 
              onClick={() => setView('discover')} 
              icon={<Search className="w-5 h-5" />} 
              label="Discover" 
            />
            <NavItem 
              active={view === 'my-books'} 
              onClick={() => setView('my-books')} 
              icon={<BookIcon className="w-5 h-5" />} 
              label="My Books" 
            />
            <NavItem 
              active={view === 'requests'} 
              onClick={() => setView('requests')} 
              icon={<Bell className="w-5 h-5" />} 
              label="Requests" 
              badge={incomingRequests.filter(r => r.status === 'Pending').length}
            />
            <NavItem 
              active={view === 'profile'} 
              onClick={() => setView('profile')} 
              icon={<UserIcon className="w-5 h-5" />} 
              label="Profile" 
            />
          </nav>
        </div>

        <button 
          onClick={logout}
          className="flex items-center gap-3 px-4 py-2 text-stone-500 hover:text-red-500 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">Logout</span>
        </button>
      </aside>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full bg-white border-t border-stone-200 px-6 py-4 flex justify-between items-center z-50">
        <MobileNavItem 
          active={view === 'discover'} 
          onClick={() => setView('discover')} 
          icon={<Search className="w-6 h-6" />} 
        />
        <MobileNavItem 
          active={view === 'my-books'} 
          onClick={() => setView('my-books')} 
          icon={<BookIcon className="w-6 h-6" />} 
        />
        <div className="relative">
          <MobileNavItem 
            active={view === 'requests'} 
            onClick={() => setView('requests')} 
            icon={<Bell className="w-6 h-6" />} 
          />
          {incomingRequests.filter(r => r.status === 'Pending').length > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-4 h-4 flex items-center justify-center rounded-full">
              {incomingRequests.filter(r => r.status === 'Pending').length}
            </span>
          )}
        </div>
        <MobileNavItem 
          active={view === 'profile'} 
          onClick={() => setView('profile')} 
          icon={<UserIcon className="w-6 h-6" />} 
        />
      </nav>

      {/* Main Content */}
      <main className="p-4 md:p-8 max-w-5xl mx-auto">
        <AnimatePresence mode="wait">
          {view === 'discover' && (
            <motion.div 
              key="discover"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="space-y-8"
            >
              <header className="space-y-4">
                <h2 className="text-3xl font-serif font-bold text-stone-900">Discover Books</h2>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
                  <input 
                    type="text" 
                    placeholder="Search by title, author or genre..." 
                    className="w-full bg-white border border-stone-200 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-olive/20 transition-all font-medium text-stone-700"
                  />
                </div>
              </header>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {books.map(book => (
                  <BookListItem 
                    key={book.id} 
                    book={book} 
                    isMine={book.ownerId === user.uid}
                    onRequest={() => handleBorrowRequest(book)}
                  />
                ))}
                {books.length === 0 && (
                  <div className="col-span-full py-12 text-center space-y-4">
                    <p className="text-stone-400 font-medium">No books shared yet in your community.</p>
                    <button 
                      onClick={() => setView('my-books')}
                      className="text-olive font-semibold hover:underline"
                    >
                      Be the first to list a book
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {view === 'my-books' && (
            <motion.div 
              key="my-books"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-3xl font-serif font-bold text-stone-900">My Library</h2>
                <button 
                  onClick={() => setIsAddingBook(true)}
                  className="btn-primary flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Add Book
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {books.filter(b => b.ownerId === user.uid).map(book => (
                  <BookListItem 
                    key={book.id} 
                    book={book} 
                    isMine={true}
                    onStatusChange={(status) => updateBookStatus(book.id, status)}
                  />
                ))}
              </div>
            </motion.div>
          )}

          {view === 'requests' && (
            <motion.div 
              key="requests"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="space-y-12"
            >
              <section className="space-y-6">
                <h3 className="text-2xl font-serif font-bold text-stone-900 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-olive/10 flex items-center justify-center">
                    <Bell className="w-4 h-4 text-olive" />
                  </div>
                  Incoming Requests
                </h3>
                <div className="space-y-4">
                  {incomingRequests.map(req => (
                    <RequestItem 
                      key={req.id} 
                      request={req} 
                      type="incoming" 
                      onAction={(status) => handleRequestAction(req, status)}
                    />
                  ))}
                  {incomingRequests.length === 0 && (
                    <p className="text-stone-400 py-4 italic">No one has requested your books yet.</p>
                  )}
                </div>
              </section>

              <section className="space-y-6">
                <h3 className="text-2xl font-serif font-bold text-stone-900 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-olive/10 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-olive" />
                  </div>
                  My Borrowing Requests
                </h3>
                <div className="space-y-4">
                  {myRequests.map(req => (
                    <RequestItem 
                      key={req.id} 
                      request={req} 
                      type="outgoing" 
                    />
                  ))}
                  {myRequests.length === 0 && (
                    <p className="text-stone-400 py-4 italic">You haven't requested any books yet.</p>
                  )}
                </div>
              </section>
            </motion.div>
          )}

          {view === 'profile' && profile && (
            <motion.div 
              key="profile"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="space-y-8"
            >
              <div className="card text-center space-y-4 py-12">
                <div className="flex justify-center">
                  <img src={profile.photoURL} className="w-24 h-24 rounded-full border-4 border-olive/20 shadow-lg" alt="" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-2xl font-serif font-bold text-stone-900">{profile.displayName}</h2>
                  <p className="text-stone-500 font-medium">{profile.email}</p>
                </div>
                <div className="flex justify-center gap-8 py-4">
                  <div className="text-center">
                    <div className="text-2xl font-serif font-bold text-olive">{profile.booksOffered}</div>
                    <div className="text-xs text-stone-400 uppercase tracking-widest font-bold">Lent</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-serif font-bold text-olive">{profile.booksBorrowed}</div>
                    <div className="text-xs text-stone-400 uppercase tracking-widest font-bold">Borrowed</div>
                  </div>
                </div>
                <div className="max-w-md mx-auto">
                  <p className="text-stone-600 leading-relaxed italic">
                    "{profile.bio || 'Book lover. Community builder. Knowledge sharer.'}"
                  </p>
                </div>
                <button 
                  onClick={logout}
                  className="text-red-500 font-semibold pt-8 hover:underline md:hidden"
                >
                  Logout from app
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Add Book Modal */}
      {isAddingBook && (
        <AddBookModal 
          onClose={() => setIsAddingBook(false)} 
          onAdd={addNewBook}
        />
      )}

      {/* Borrow Modal */}
      {borrowingBook && (
        <BorrowModal 
          book={borrowingBook}
          onClose={() => setBorrowingBook(null)}
          onConfirm={(msg) => createRequest(borrowingBook, msg)}
        />
      )}
    </div>
  );
}

// Subcomponents
function NavItem({ active, onClick, icon, label, badge }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string, badge?: number, key?: any }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between px-4 py-3 rounded-2xl transition-all duration-200",
        active ? "bg-olive text-white shadow-lg shadow-olive/20" : "text-stone-500 hover:bg-stone-50"
      )}
    >
      <div className="flex items-center gap-3">
        {icon}
        <span className="font-semibold">{label}</span>
      </div>
      {badge !== undefined && badge > 0 && (
        <span className={cn(
          "text-[10px] w-5 h-5 flex items-center justify-center rounded-full font-bold",
          active ? "bg-white text-olive" : "bg-red-500 text-white"
        )}>
          {badge}
        </span>
      )}
    </button>
  );
}

function MobileNavItem({ active, onClick, icon, key }: { active: boolean, onClick: () => void, icon: React.ReactNode, key?: any }) {
  return (
    <button onClick={onClick} className={cn("p-2 transition-colors", active ? "text-olive" : "text-stone-400")}>
      {icon}
    </button>
  );
}

function BookListItem({ book, isMine, onRequest, onStatusChange, key }: { book: Book, isMine: boolean, onRequest?: () => void, onStatusChange?: (s: BookStatus) => void, key?: any }) {
  return (
    <motion.div 
      whileHover={{ y: -4 }}
      className="card flex flex-col h-full group"
    >
      <div className="aspect-[3/4] relative mb-4 overflow-hidden rounded-2xl bg-stone-100">
        {book.coverImage ? (
          <img src={book.coverImage} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt={book.title} />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-stone-300 p-6 text-center">
            <BookIcon className="w-12 h-12 mb-2 opacity-20" />
            <span className="text-[10px] uppercase tracking-widest font-bold opacity-40">No Cover Available</span>
          </div>
        )}
        <div className="absolute top-3 right-3 flex flex-col gap-2">
          <span className={cn(
            "text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-wider backdrop-blur-md",
            book.availabilityStatus === 'Available' ? "bg-green-500/80 text-white" : "bg-stone-500/80 text-white"
          )}>
            {book.availabilityStatus}
          </span>
          <span className="bg-white/80 backdrop-blur-md text-stone-900 text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-wider">
            {book.genre}
          </span>
        </div>
      </div>

      <div className="flex-1">
        <h4 className="font-serif font-bold text-xl text-stone-900 leading-tight mb-1">{book.title}</h4>
        <p className="text-stone-500 text-sm font-medium mb-4 italic">by {book.author}</p>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-full bg-stone-200 flex items-center justify-center text-[10px] font-bold text-stone-600">
            {book.ownerName?.[0]}
          </div>
          <span className="text-[11px] text-stone-400 font-semibold uppercase tracking-wider">Shared by {isMine ? 'You' : book.ownerName}</span>
        </div>
      </div>

      <div className="pt-4 border-t border-stone-50">
        {!isMine ? (
          <button 
            disabled={book.availabilityStatus !== 'Available'}
            onClick={onRequest}
            className="w-full btn-primary"
          >
            Request to Borrow
          </button>
        ) : (
          <div className="flex items-center justify-between gap-2">
             <select 
              value={book.availabilityStatus}
              onChange={(e) => onStatusChange?.(e.target.value as BookStatus)}
              className="grow bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
             >
                <option value="Available">Available</option>
                <option value="Borrowed">Borrowed</option>
                <option value="Hidden">Hidden</option>
             </select>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function RequestItem({ request, type, onAction, key }: { request: BorrowRequest, type: 'incoming' | 'outgoing', onAction?: (s: RequestStatus) => void, key?: any }) {
  const statusColors = {
    'Pending': 'bg-amber-100 text-amber-700',
    'Accepted': 'bg-green-100 text-green-700',
    'Rejected': 'bg-red-100 text-red-700',
    'Returned': 'bg-blue-100 text-blue-700',
    'Cancelled': 'bg-stone-100 text-stone-700'
  } as const;

  return (
    <div className="card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div className="grow space-y-1">
        <div className="flex items-center gap-3">
          <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-widest", statusColors[request.status])}>
            {request.status}
          </span>
          <span className="text-[10px] text-stone-400 font-medium">
            {request.createdAt ? formatDistanceToNow(request.createdAt.toDate()) + ' ago' : ''}
          </span>
        </div>
        <h4 className="font-serif font-bold text-lg text-stone-900">
          {type === 'incoming' ? `${request.borrowerName} wants ` : 'You requested '}
          <span className="text-olive underline underline-offset-4 font-normal italic">{request.bookTitle}</span>
        </h4>
        {request.message && (
          <p className="text-sm text-stone-500 italic border-l-2 border-stone-200 pl-3 py-1 mt-2">
            "{request.message}"
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0">
        {type === 'incoming' && request.status === 'Pending' && (
          <>
            <button 
              onClick={() => onAction?.('Accepted')}
              className="grow sm:grow-0 bg-olive text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-opacity-90 flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              Approve
            </button>
            <button 
              onClick={() => onAction?.('Rejected')}
              className="grow sm:grow-0 bg-stone-100 text-stone-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-stone-200 flex items-center justify-center gap-2"
            >
              <XCircle className="w-4 h-4" />
              Decline
            </button>
          </>
        )}
        {type === 'incoming' && request.status === 'Accepted' && (
          <button 
            onClick={() => onAction?.('Returned')}
            className="w-full sm:w-auto border border-stone-200 text-stone-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-stone-50"
          >
            Mark as Returned
          </button>
        )}
      </div>
    </div>
  );
}

function AddBookModal({ onClose, onAdd }: { onClose: () => void, onAdd: (data: any) => void }) {
  const [formData, setFormData] = useState({
    title: '',
    author: '',
    genre: 'Fiction',
    description: '',
    condition: 'Gently Used' as const,
    language: 'English',
    coverImage: ''
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-white rounded-[40px] w-full max-w-xl p-8 max-h-[90vh] overflow-y-auto no-scrollbar shadow-2xl"
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-3xl font-serif font-bold text-stone-900">Add a New Book</h3>
            <p className="text-stone-500 font-medium">List a book to help someone in your community grow.</p>
          </div>

          <div className="space-y-4 pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Book Title" value={formData.title} onChange={v => setFormData({...formData, title: v})} placeholder="e.g. The Alchemist" />
              <Input label="Author" value={formData.author} onChange={v => setFormData({...formData, author: v})} placeholder="e.g. Paulo Coelho" />
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 grow">
                <label className="text-xs font-bold uppercase tracking-widest text-stone-400 ml-1">Genre</label>
                <select 
                  className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 text-stone-700 font-medium focus:outline-none focus:ring-2 focus:ring-olive/20"
                  value={formData.genre}
                  onChange={e => setFormData({...formData, genre: e.target.value})}
                >
                  {['Fiction', 'Non-Fiction', 'Academic', 'Thriller', 'Romance', 'Sci-Fi', 'Biography', 'Self-Help', 'Children'].map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 grow">
                <label className="text-xs font-bold uppercase tracking-widest text-stone-400 ml-1">Condition</label>
                <select 
                  className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 text-stone-700 font-medium focus:outline-none focus:ring-2 focus:ring-olive/20"
                  value={formData.condition}
                  onChange={e => setFormData({...formData, condition: e.target.value as any})}
                >
                  <option value="New">Brand New</option>
                  <option value="Gently Used">Gently Used</option>
                  <option value="Well Loved">Well Loved</option>
                </select>
              </div>
            </div>

            <Input label="Cover Image URL (Optional)" value={formData.coverImage} onChange={v => setFormData({...formData, coverImage: v})} placeholder="https://image-url.com/book.jpg" />

            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-widest text-stone-400 ml-1">About the Book</label>
              <textarea 
                className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 text-stone-700 font-medium focus:outline-none focus:ring-2 focus:ring-olive/20 min-h-[100px]"
                placeholder="Share a little bit about what this book is about..."
                value={formData.description}
                onChange={e => setFormData({...formData, description: e.target.value})}
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-6">
            <button 
              onClick={() => onAdd(formData)}
              disabled={!formData.title || !formData.author}
              className="grow btn-primary py-4"
            >
              List Book in Community
            </button>
            <button 
              onClick={onClose}
              className="grow sm:grow-0 px-8 py-4 text-stone-400 font-bold hover:text-stone-600 transition-colors uppercase tracking-widest text-[10px]"
            >
              Cancel
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function BorrowModal({ book, onClose, onConfirm }: { book: Book, onClose: () => void, onConfirm: (msg: string) => void }) {
  const [message, setMessage] = useState('');

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
       <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-white rounded-[40px] w-full max-w-lg p-8 shadow-2xl"
      >
        <div className="space-y-6">
          <div className="flex gap-4">
            <div className="w-24 shrink-0 aspect-[3/4] rounded-xl bg-stone-100 overflow-hidden shadow-md">
              {book.coverImage && <img src={book.coverImage} className="w-full h-full object-cover" alt="" />}
            </div>
            <div className="space-y-1">
               <h3 className="text-2xl font-serif font-bold text-stone-900 leading-tight">Borrowing</h3>
               <p className="text-olive font-serif text-xl font-medium italic underline decoration-olive/30 decoration-2 underline-offset-4">{book.title}</p>
               <p className="text-stone-400 text-sm font-medium pt-1">by {book.author}</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-stone-400 ml-1">Send a Message (Optional)</label>
            <textarea 
              className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-4 text-stone-700 font-medium focus:outline-none focus:ring-2 focus:ring-olive/20 min-h-[120px]"
              placeholder="Hi! I'd love to read this book. I promise to take good care of it..."
              value={message}
              onChange={e => setMessage(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-3 pt-4">
             <button 
              onClick={() => onConfirm(message)}
              className="w-full btn-primary py-4"
            >
              Send Borrow Request
            </button>
            <button 
              onClick={onClose}
              className="w-full py-2 text-stone-400 font-bold hover:text-stone-600 transition-colors uppercase tracking-widest text-[10px]"
            >
              Go Back
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function Input({ label, value, onChange, placeholder, type = 'text' }: { label: string, value: string, onChange: (v: string) => void, placeholder: string, type?: string }) {
  return (
    <div className="space-y-1.5 grow">
      <label className="text-xs font-bold uppercase tracking-widest text-stone-400 ml-1">{label}</label>
      <input 
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 text-stone-700 font-medium focus:outline-none focus:ring-2 focus:ring-olive/20 placeholder:text-stone-300 transition-all font-sans"
      />
    </div>
  );
}
