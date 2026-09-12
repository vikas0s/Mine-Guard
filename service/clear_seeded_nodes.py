"""
clear_seeded_nodes.py
Deletes seeded/test node documents from Firestore nodes collection.
"""
import sys
import argparse
import firebase_admin
from firebase_admin import credentials, firestore

SERVICE_ACCOUNT_PATH = "serviceAccountKey.json"
COLLECTION_NAME = "nodes"
SEEDED_NODE_IDS = ["N01", "N02", "N03", "N04"]

def delete_subcollections(doc_ref):
    for subcol in doc_ref.collections():
        docs = list(subcol.stream())
        for d in docs:
            delete_subcollections(d.reference)
            d.reference.delete()
        print(f"    Deleted {len(docs)} doc(s) from subcollection '{subcol.id}'")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm", action="store_true")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()

    try:
        cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
        firebase_admin.initialize_app(cred)
    except FileNotFoundError:
        print(f"ERROR: Could not find '{SERVICE_ACCOUNT_PATH}'.")
        print("Download it from Firebase Console -> Project Settings -> Service Accounts.")
        sys.exit(1)

    db = firestore.client()
    col_ref = db.collection(COLLECTION_NAME)

    if args.all:
        docs = list(col_ref.stream())
    else:
        docs = [col_ref.document(nid).get() for nid in SEEDED_NODE_IDS]
        docs = [d for d in docs if d.exists]

    if not docs:
        print("No matching documents found. Nothing to do.")
        return

    print(f"Found {len(docs)} document(s) in '{COLLECTION_NAME}':")
    for d in docs:
        data = d.to_dict() or {}
        print(f"  - {d.id}  (name: {data.get('name', 'n/a')})")

    if not args.confirm:
        print("\nDry run only. Re-run with --confirm to actually delete these documents.")
        return

    print("\nDeleting...")
    for d in docs:
        delete_subcollections(d.reference)
        d.reference.delete()
        print(f"  Deleted node '{d.id}'")

    print(f"\nDone. Deleted {len(docs)} node document(s).")

if __name__ == "__main__":
    main()
