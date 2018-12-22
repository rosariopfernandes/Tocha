const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const firestore = admin.firestore();
firestore.settings({timestampsInSnapshots: true});

const lunr = require('lunr');
const tochaCollection = 'tocha_searches';

// Full Text-Search on Cloud Firestore
exports.searchFirestore = functions.firestore
    .document(tochaCollection + '/{searchId}')
    .onCreate(async (snap, context) => {
        // Obtain the request parameters
        const req = snap.data();
        const collectionName = req.collectionName;
        const fields = req.fields;
        const query = req.query;
        const queryRef = req.queryRef;
        const where = req.where; // array containing all the extra queries
        const orderBy = req.orderBy; // object containing field and direction
        const limit = req.limit;

        // Construct the query to the collection being searched
        var userCollection = firestore.collection(collectionName);
        if (where) {
            where.forEach(function(subquery) {
                userCollection = userCollection.where(subquery.field, subquery.operator, subquery.val);
            });
        }
        if (orderBy) {
            orderBy.forEach(function (sortOrder) {
                if (sortOrder.direction) {
                    userCollection = userCollection.orderBy(sortOrder.field, sortOrder.direction);
                } else {
                    userCollection = userCollection.orderBy(sortOrder.field);
                }
            });
        }
        if (limit) {
            userCollection = userCollection.limit(limit);
        }

        // Read all the documents from the collection to be searched
        const querySnapshot = await userCollection.get();
        var documents = [];
        var lunrIndex = lunr(function() {
            if (queryRef) {
                this.ref(queryRef);
            } else {
                this.ref('key');
            }
            for (var i in fields) {
                this.field(fields[i]);
            }
            querySnapshot.forEach(function (docSnapshot) {
                var snapshotData = docSnapshot.data();
                documents[docSnapshot.id] = docSnapshot.data();
                snapshotData.key = docSnapshot.id;
                this.add(snapshotData);
            }, this);
        });
        const results = lunrIndex.search(query);
        var response = [];
        results.forEach(function(result) {
            response.push({
                id: result.ref,
                score: result.score,
                data: documents[result.ref]
            })
        });
        return firestore.collection(tochaCollection).doc(context.params.searchId)
            .update({
                response: response,
                responseTimestamp: admin.firestore.FieldValue.serverTimestamp()
            });
    });

// Full Text-Search on the Realtime Database
exports.searchRTDB = functions.database
    .ref(tochaCollection + '/{searchId}')
    .onCreate((snap, context) => {
        // Obtain the request parameters
        const req = snap.val();
        const nodeName = req.collectionName;
        const fields = req.fields;
        const query = req.query;
        const queryRef = req.queryRef;
        const orderByChild = req.orderChild;
        const orderByKey = req.orderKey;
        const orderByValue = req.orderValue;
        const limitToFirst = req.limitFirst;
        const limitToLast = req.limitLast;
        const startAt = req.startAtBound;
        const endAt = req.endAtBound;
        const equalTo = req.equalToBound;

        // Construct the query
        const database = admin.database();
        var databaseRef = database.ref(nodeName);
        if (orderByChild) {
            databaseRef = databaseRef.orderByChild(orderByChild);
        } else {
            if (orderByValue) {
                databaseRef = databaseRef.orderByValue();
            } else {
                if (orderByKey) {
                    databaseRef = databaseRef.orderByKey();
                }
            }
        }

        if (limitToFirst) {
            databaseRef = databaseRef.limitToFirst(limitToFirst);
        } else {
            if (limitToLast) {
                databaseRef = databaseRef.limitToLast(limitToLast);
            }
        }

        if (startAt) {
            databaseRef = databaseRef.startAt(startAt);
        }

        if (endAt) {
            databaseRef = databaseRef.endAt(endAt);
        }

        if (equalTo) {
            databaseRef = databaseRef.equalTo(equalTo);
        }


        // Read everything from the node to be searched

        return databaseRef
            .once('value', function(dataSnapshot) {
                var documents = new Map();
                dataSnapshot.forEach(function (snapshot) {
                    var snapshotVal = snapshot.val();
                    snapshotVal.key = snapshot.key;
                    documents.set(snapshot.key, snapshotVal);
                });
                var lunrIndex = lunr(function () {
                    if (queryRef) { this.ref(queryRef); } else { this.ref('key'); }

                    for (var i in fields) { this.field(fields[i]); }

                    documents.forEach(function (value) { this.add(value); }, this);
                });
                const results = lunrIndex.search(query);
                const response = [];
                results.forEach(function (result) {
                    response.push({
                        id: result.ref,
                        score: result.score,
                        data: documents.get(result.ref)
                    });
                });
                database.ref(tochaCollection).child(context.params.searchId)
                    .update({
                        response: response,
                        responseTimestamp: admin.database.ServerValue.TIMESTAMP
                    });
            })
    });
