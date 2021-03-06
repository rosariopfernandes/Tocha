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
        let responseResults = [];
        let response = {
            result: responseResults
        };
        try {
            // Obtain the request parameters
            const req = snap.data();
            const collectionName = req.collectionName;
            const fields = req.fields;
            const query = req.query;
            const queryRef = req.queryRef;
            const where = req.where; // array containing all the extra queries
            const orderBy = req.orderBy; // object containing field and direction
            const limit = req.limit;
            const limitToLast = req.limitToLast;

            // Construct the query to the collection being searched
            let userCollection = firestore.collection(collectionName);
            if (where) {
                where.forEach(function(subquery) {
                    if (subquery.val && subquery.field && subquery.operator) {
                        userCollection = userCollection.where(subquery.field, subquery.operator, subquery.val);
                    } else if (subquery.value && subquery.field && subquery.operator) {
                        userCollection = userCollection.where(subquery.field, subquery.operator, subquery.value);
                    }
                });
            }
            if (orderBy) {
                orderBy.forEach(function (sortOrder) {
                    if (sortOrder.direction && sortOrder.field) {
                        userCollection = userCollection.orderBy(sortOrder.field, sortOrder.direction);
                    } else if (sortOrder.field) {
                        userCollection = userCollection.orderBy(sortOrder.field);
                    }
                });
            }
            if (limit) {
                userCollection = userCollection.limit(limit);
            } else if (limitToLast) {
                userCollection = userCollection.limitToLast(limitToLast);
            }

            // Read all the documents from the collection to be searched
            const querySnapshot = await userCollection.get();
            let documents = [];
            let lunrIndex = lunr(function() {
                if (queryRef) {
                    this.ref(queryRef);
                } else {
                    this.ref('key');
                }
                for (let i in fields) {
                    this.field(fields[i]);
                }
                querySnapshot.forEach(function (docSnapshot) {
                    let snapshotData = docSnapshot.data();
                    documents[docSnapshot.id] = docSnapshot.data();
                    snapshotData.key = docSnapshot.id;
                    this.add(snapshotData);
                }, this);
            });
            const results = lunrIndex.search(query);
            results.forEach(function(result) {
                responseResults.push({
                    id: result.ref,
                    score: result.score,
                    data: documents[result.ref]
                })
            });
            response.isSuccessful = true;
        } catch (e) {
            console.log(e);
            response.isSuccessful = false;
            response.errorMessage = e.toString();
        }


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
        const responseResults = [];
        let response = {
            result: responseResults
        };
        const database = admin.database();
        try {
            // Obtain the request parameters
            const req = snap.val();
            const nodeName = req.collectionName;
            const fields = req.fields;
            const query = req.query;
            const queryRef = req.queryRef;

            // Read everything from the node to be searched
            return database.ref(nodeName)
                .once('value', function(dataSnapshot) {
                    try {
                        let documents = new Map();
                        dataSnapshot.forEach(function (snapshot) {
                            let snapshotVal = snapshot.val();
                            snapshotVal.key = snapshot.key;
                            documents.set(snapshot.key, snapshotVal);
                        });
                        let lunrIndex = lunr(function () {
                            if (queryRef) { this.ref(queryRef); } else { this.ref('key'); }

                            for (let i in fields) { this.field(fields[i]); }

                            documents.forEach(function (value) { this.add(value); }, this);
                        });
                        const results = lunrIndex.search(query);
                        results.forEach(function (result) {
                            responseResults.push({
                                id: result.ref,
                                score: result.score,
                                data: documents.get(result.ref)
                            });
                        });
                        response.isSuccessful = true;
                    } catch (e) {
                        response.isSuccessful = false;
                        response.errorMessage = e.toString();
                    }
                    database.ref(tochaCollection).child(context.params.searchId)
                        .update({
                            response: response,
                            responseTimestamp: admin.database.ServerValue.TIMESTAMP
                        });
                })
        } catch (e) {
            response.isSuccessful = false;
            response.errorMessage = e.toString();
            return database.ref(tochaCollection).child(context.params.searchId)
                .update({
                    response: response,
                    responseTimestamp: admin.database.ServerValue.TIMESTAMP
                });
        }

    });
