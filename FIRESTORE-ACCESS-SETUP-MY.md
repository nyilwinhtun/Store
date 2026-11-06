# Firebase Owner / Cashier Access & Cloud Sync — New Minimart Project

## Project
- Firebase Project: `minimart-production`
- Firestore Region: Singapore (`asia-southeast1`)
- Business ID: `store-mini-main` (internal namespace; retained for code compatibility)
- Owner Email: `tunk51122@gmail.com`
- Owner UID: `LjZX15uSeehtIbyL4SqO1HcyLyC2`
- Owner Access: `businesses/store-mini-main.ownerUid`
- Cashier Membership: `businesses/store-mini-main/members/{uid}`

## Initial Firestore Setup
New Firestore is currently empty and the Console screenshot shows deny-all Rules. Follow `NEW-FIREBASE-PROJECT-SETUP-MY.md`: first seed the `businesses/store-mini-main` parent document with the Owner UID and `active: true`, then publish the included `firestore.rules`. Do not add the Cashier UID to `ownerUid`.

## Cloud Sync Paths
```text
businesses/store-mini-main/
  ownerUid: <NEW_OWNER_UID>
  branches/{branchId}
  branches/{branchId}/{recordCollection}/{recordId}
  members/{cashierUid}
  shared/customers/records/{customerId}
  shared/suppliers/records/{supplierId}
  meta/settings
```

Branch-specific collections: `categories`, `products`, `sales`, `expenses`, `heldItems`, `customerPayments`, `purchases`, `supplierPayments`, `purchaseReturns`, `stockBatches`, `stockReceipts`, `stockTransfers`, `cashShifts`, `cashMovements`, `activityLogs`.

## Rules
The supplied `firestore.rules` is tailored to this dedicated Project and pins the initial Owner UID. It allows the Owner to manage Cashier membership, keeps Cashier assigned to one Branch and blocks Cashier cloud stock writes. All unspecified paths remain denied. If the Owner account changes, update the pinned UID in Rules deliberately and test before publishing.

## Migration Warning
Authentication users are Project-specific. The Owner and Cashier accounts visible in `minimart-production` are new Project users and have new UIDs. Use the new Project's Cashier UID when linking the existing Auth account. Do not reuse old `store-mini` UIDs unless those users are separately imported with the same UID.

Do not start Laptop and Phone bootstrap at the same time. Back up both devices first, then use the device with the most complete current data as the first Owner source device. Verify Firestore records before connecting the second device.
