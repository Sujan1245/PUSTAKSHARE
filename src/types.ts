export type BookCondition = 'New' | 'Gently Used' | 'Well Loved';
export type BookStatus = 'Available' | 'Borrowed' | 'Hidden';
export type RequestStatus = 'Pending' | 'Accepted' | 'Rejected' | 'Returned' | 'Cancelled';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  bio?: string;
  location?: string;
  booksOffered: number;
  booksBorrowed: number;
  createdAt: any; // Firestore Timestamp
}

export interface Book {
  id: string; // Document ID
  title: string;
  author: string;
  genre: string;
  description: string;
  condition: BookCondition;
  language: string;
  ownerId: string;
  ownerName: string;
  availabilityStatus: BookStatus;
  coverImage?: string;
  createdAt: any;
  updatedAt: any;
}

export interface BorrowRequest {
  id: string;
  bookId: string;
  bookTitle: string;
  lenderId: string;
  borrowerId: string;
  borrowerName: string;
  message: string;
  status: RequestStatus;
  createdAt: any;
  updatedAt: any;
}
