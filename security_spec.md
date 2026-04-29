# PustakShare Security Specification

## Data Invariants
1. **User Identity Invariant**: A user profile can only be created and updated by the user who owns the account (`request.auth.uid == userId`).
2. **Book Ownership Invariant**: A book entry can only be created by an authenticated user, and updated/deleted only by its owner (`ownerId == request.auth.uid`).
3. **Request Integrity Invariant**: A borrow request must originate from an authenticated user (the borrower) and cannot be modified by the borrower once sent, except for cancellation.
4. **Lender Authority Invariant**: Only the lender can approve or reject an incoming borrow request for their own book.
5. **Status Lifecycle Invariant**: A request status cannot skip logical steps (e.g., from Pending to Returned without being Accepted first).

## The "Dirty Dozen" Payloads (Deny Expected)

1. **Spoofing Owner**: Attempting to create a book with someone else's `ownerId`.
2. **Shadow Update**: Attempting to update a book and changing the `ownerId` to someone else.
3. **Escalating Request**: A borrower trying to update a request status from `Pending` to `Accepted`.
4. **Unauthorized Deletion**: A user trying to delete a book listing they don't own.
5. **Profile Hijack**: A user trying to update another user's profile bio.
6. **Malicious ID**: Using a 2KB string as a document ID (blocked by `isValidId`).
7. **Bypassing Timestamp**: Providing a hardcoded future date for `createdAt` instead of `serverTimestamp()`.
8. **Invalid Status**: Setting a book's status to `Sold` (not in allowed enum).
9. **Tampering borrower info**: Borrower trying to change `borrowerName` after the request is created.
10. **Ghost Fields**: Adding `isVerified: true` to a user profile (blocked by `affectedKeys().hasOnly`).
11. **Negative Counters**: Setting `booksOffered` to `-1`.
12. **Unverified State**: Updating a request for a book that has been deleted (relational check).

## Conflict Report

| Collection | Identity Spoofing | State Shortcutting | Resource Poisoning |
|------------|-------------------|--------------------|--------------------|
| users      | Blocked (isOwner) | N/A                | Blocked (isValid)  |
| books      | Blocked (isOwner) | N/A                | Blocked (isValid)  |
| requests   | Blocked (auth.uid)| Blocked (logic)    | Blocked (isValid)  |
