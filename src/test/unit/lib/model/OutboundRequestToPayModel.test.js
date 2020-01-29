/**************************************************************************
 *  (C) Copyright ModusBox Inc. 2019 - All rights reserved.               *
 *                                                                        *
 *  This file is made available under the terms of the license agreement  *
 *  specified in the corresponding source code repository.                *
 *                                                                        *
 *  ORIGINAL AUTHOR:                                                      *
 *       Murthy Kakarlamudi - murthy@modusbox.com                             *
 **************************************************************************/

'use strict';

// we use a mock standard components lib to intercept and mock certain funcs
jest.mock('@mojaloop/sdk-standard-components');
jest.mock('redis');

const util = require('util');
const Cache = require('@internal/cache');
const Model = require('@internal/model').OutboundRequestToPayModel;
const { Logger, Transports } = require('@internal/log');

const { MojaloopRequests } = require('@mojaloop/sdk-standard-components');
const StateMachine = require('javascript-state-machine');

const defaultConfig = require('./data/defaultConfig');
const requestToPayRequest = require('./data/requestToPayRequest');
const payeeParty = require('./data/payeeParty');
const transactionRequestResponseTemplate = require('./data/transactionRequestResponse');

const genPartyId = (party) => {
    const { partyIdType, partyIdentifier, partySubIdOrType } = party.party.partyIdInfo;
    return `${partyIdType}_${partyIdentifier}` + (partySubIdOrType ? `_${partySubIdOrType}` : '');
};

// util function to simulate a party resolution subscription message on a cache client
const emitPartyCacheMessage = (cache, party) => cache.publish(genPartyId(party), JSON.stringify(party));

// util function to simulate a quote response subscription message on a cache client
const emitTransactionRequestResponseCacheMessage = (cache, transactionRequestId, transactionRequestResponse) => cache.publish(`tr_${transactionRequestId}`, JSON.stringify(transactionRequestResponse));

// // util function to simulate a quote response subscription message on a cache client
// const emitQuoteResponseCacheMessage = (cache, quoteId, quoteResponse) => cache.publish(`qt_${quoteId}`, JSON.stringify(quoteResponse));

// // util function to simulate a transfer fulfilment subscription message on a cache client
// const emitTransferFulfilCacheMessage = (cache, transferId, fulfil) => cache.publish(`tf_${transferId}`, JSON.stringify(fulfil));

describe('outboundModel', () => {
    let transactionRequestResponse;
    let config;
    let logger;
    let cache;

    /**
     *
     * @param {Object} opts
     * @param {Number} opts.expirySeconds
     * @param {Object} opts.delays
     * @param {Number} delays.requestQuotes
     * @param {Number} delays.prepareTransfer
     * @param {Object} opts.rejects
     * @param {boolean} rejects.quoteResponse
     * @param {boolean} rejects.transferFulfils
     */
    
    beforeAll(async () => {
        const logTransports = await Promise.all([Transports.consoleDir()]);
        logger = new Logger({ context: { app: 'outbound-model-unit-tests-cache' }, space: 4, transports: logTransports });
        transactionRequestResponse = JSON.parse(JSON.stringify(transactionRequestResponseTemplate));
    });

    beforeEach(async () => {
        config = JSON.parse(JSON.stringify(defaultConfig));
        MojaloopRequests.__postParticipants = jest.fn(() => Promise.resolve());
        MojaloopRequests.__getParties = jest.fn(() => Promise.resolve());
        MojaloopRequests.__postTransactionRequests = jest.fn(() => Promise.resolve());
        
        cache = new Cache({
            host: 'dummycachehost',
            port: 1234,
            logger,
        });
        await cache.connect();
    });

    afterEach(async () => {
        await cache.disconnect();
    });

    test('initializes to starting state', async () => {
        const model = new Model({
            cache,
            logger,
            ...config,
        });

        await model.initialize(JSON.parse(JSON.stringify(requestToPayRequest)));
        expect(StateMachine.__instance.state).toBe('start');
    });


    test('executes all two stages without halting when AUTO_ACCEPT_PARTY is true', async () => {
        config.autoAcceptParty = true;
        
        MojaloopRequests.__getParties = jest.fn(() => {
            emitPartyCacheMessage(cache, payeeParty);
            return Promise.resolve();
        });

        MojaloopRequests.__postTransactionRequests = jest.fn((postTransactionRequestsBody) => {
            // ensure that the `MojaloopRequests.postTransactionRequestsBody` method has been called with correct arguments
            // including extension list
            // const extensionList = postTransactionRequestsBody.extensionList;
            // expect(extensionList).toBeTruthy();
            // expect(extensionList.extension).toBeTruthy();
            // expect(extensionList.extension.length).toBe(2);
            // expect(extensionList.extension[0]).toEqual({ key: 'key1', value: 'value1' });
            // expect(extensionList.extension[1]).toEqual({ key: 'key2', value: 'value2' });

            // simulate a callback with the quote response
            emitTransactionRequestResponseCacheMessage(cache, postTransactionRequestsBody.transactionRequestId, transactionRequestResponse);
            return Promise.resolve();
        });

        const model = new Model({
            cache,
            logger,
            ...config,
        });

        await model.initialize(JSON.parse(JSON.stringify(requestToPayRequest)));

        expect(StateMachine.__instance.state).toBe('start');

        // start the model running
        const result = await model.run();

        console.log(`Result after two stage transfer: ${util.inspect(result)}`);

        expect(MojaloopRequests.__getParties).toHaveBeenCalledTimes(1);
        expect(MojaloopRequests.__postTransactionRequests).toHaveBeenCalledTimes(1);
        
        // check we stopped at payeeResolved state
        expect(result.currentState).toBe('COMPLETED');
        expect(result.transactionRequestResponse.transactionRequestState).toBe('RECEIVED');
        expect(StateMachine.__instance.state).toBe('succeeded');
    });


    // test('uses quote response transfer amount for transfer prepare', async () => {
    //     config.autoAcceptParty = true;
    //     config.autoAcceptQuotes = true;

    //     MojaloopRequests.__getParties = jest.fn(() => {
    //         emitPartyCacheMessage(cache, payeeParty);
    //         return Promise.resolve();
    //     });

    //     // change the the transfer amount and currency in the quote response
    //     // so it is different to the initial request
    //     quoteResponse.data.transferAmount = {
    //         currency: 'XYZ',
    //         amount: '9876543210'
    //     };

    //     expect(quoteResponse.data.transferAmount).not.toEqual({
    //         amount: transferRequest.amount,
    //         currency: transferRequest.currency
    //     });

    //     MojaloopRequests.__postQuotes = jest.fn((postQuotesBody) => {
    //         // ensure that the `MojaloopRequests.postQuotes` method has been called with correct arguments
    //         // including extension list
    //         const extensionList = postQuotesBody.extensionList;
    //         expect(extensionList).toBeTruthy();
    //         expect(extensionList.extension).toBeTruthy();
    //         expect(extensionList.extension.length).toBe(2);
    //         expect(extensionList.extension[0]).toEqual({ key: 'qkey1', value: 'qvalue1' });
    //         expect(extensionList.extension[1]).toEqual({ key: 'qkey2', value: 'qvalue2' });

    //         // simulate a callback with the quote response
    //         emitQuoteResponseCacheMessage(cache, postQuotesBody.quoteId, quoteResponse);
    //         return Promise.resolve();
    //     });

    //     MojaloopRequests.__postTransfers = jest.fn((postTransfersBody, destFspId) => {
    //         //ensure that the `MojaloopRequests.postTransfers` method has been called with the correct arguments
    //         // set as the destination FSPID, picked up from the header's value `fspiop-source`
    //         expect(model.data.quoteResponseSource).toBe(quoteResponse.headers['fspiop-source']);

    //         const extensionList = postTransfersBody.extensionList;
    //         expect(extensionList.extension).toBeTruthy();
    //         expect(extensionList.extension.length).toBe(2);
    //         expect(extensionList.extension[0]).toEqual({ key: 'tkey1', value: 'tvalue1' });
    //         expect(extensionList.extension[1]).toEqual({ key: 'tkey2', value: 'tvalue2' });

    //         expect(destFspId).toBe(quoteResponse.headers['fspiop-source']);
    //         expect(model.data.to.fspId).toBe(payeeParty.party.partyIdInfo.fspId);
    //         expect(quoteResponse.headers['fspiop-source']).not.toBe(model.data.to.fspId);

    //         expect(postTransfersBody.amount).toEqual(quoteResponse.data.transferAmount);

    //         // simulate a callback with the transfer fulfilment
    //         emitTransferFulfilCacheMessage(cache, postTransfersBody.transferId, transferFulfil);
    //         return Promise.resolve();
    //     });

    //     const model = new Model({
    //         cache,
    //         logger,
    //         ...config,
    //     });

    //     await model.initialize(JSON.parse(JSON.stringify(transferRequest)));

    //     expect(StateMachine.__instance.state).toBe('start');

    //     // start the model running
    //     const result = await model.run();

    //     console.log(`Result after three stage transfer: ${util.inspect(result)}`);

    //     expect(MojaloopRequests.__getParties).toHaveBeenCalledTimes(1);
    //     expect(MojaloopRequests.__postQuotes).toHaveBeenCalledTimes(1);
    //     expect(MojaloopRequests.__postTransfers).toHaveBeenCalledTimes(1);

    //     // check we stopped at payeeResolved state
    //     expect(result.currentState).toBe('COMPLETED');
    //     expect(StateMachine.__instance.state).toBe('succeeded');
    // });


    // test('resolves payee and halts when AUTO_ACCEPT_PARTY is false', async () => {
    //     config.autoAcceptParty = false;

    //     const model = new Model({
    //         cache,
    //         logger,
    //         ...config,
    //     });

    //     await model.initialize(JSON.parse(JSON.stringify(transferRequest)));

    //     expect(StateMachine.__instance.state).toBe('start');

    //     // start the model running
    //     const resultPromise = model.run();

    //     // now we started the model running we simulate a callback with the resolved party
    //     emitPartyCacheMessage(cache, payeeParty);

    //     // wait for the model to reach a terminal state
    //     const result = await resultPromise;

    //     console.log(`Result after resolve payee: ${util.inspect(result)}`);

    //     // check we stopped at payeeResolved state
    //     expect(result.currentState).toBe('WAITING_FOR_PARTY_ACCEPTANCE');
    //     expect(StateMachine.__instance.state).toBe('payeeResolved');
    // });


    // test('halts after resolving payee, resumes and then halts after receiving quote response when AUTO_ACCEPT_PARTY is false and AUTO_ACCEPT_QUOTES is false', async () => {
    //     config.autoAcceptParty = false;
    //     config.autoAcceptQuotes = false;

    //     let model = new Model({
    //         cache,
    //         logger,
    //         ...config,
    //     });

    //     await model.initialize(JSON.parse(JSON.stringify(transferRequest)));

    //     expect(StateMachine.__instance.state).toBe('start');

    //     // start the model running
    //     let resultPromise = model.run();

    //     // now we started the model running we simulate a callback with the resolved party
    //     emitPartyCacheMessage(cache, payeeParty);

    //     // wait for the model to reach a terminal state
    //     let result = await resultPromise;

    //     console.log(`Result after resolve payee: ${util.inspect(result)}`);

    //     // check we stopped at payeeResolved state
    //     expect(result.currentState).toBe('WAITING_FOR_PARTY_ACCEPTANCE');
    //     expect(StateMachine.__instance.state).toBe('payeeResolved');

    //     const transferId = result.transferId;

    //     // load a new model from the saved state
    //     model = new Model({
    //         cache,
    //         logger,
    //         ...config,
    //     });

    //     await model.load(transferId);

    //     // check the model loaded to the correct state
    //     expect(StateMachine.__instance.state).toBe('payeeResolved');

    //     // now run the model again. this should trigger transition to quote request
    //     resultPromise = model.run();

    //     // now we started the model running we simulate a callback with the quote response
    //     cache.publish(`qt_${model.data.quoteId}`, JSON.stringify(quoteResponse));

    //     // wait for the model to reach a terminal state
    //     result = await resultPromise;

    //     console.log(`Result after request quote: ${util.inspect(result)}`);

    //     // check we stopped at payeeResolved state
    //     expect(result.currentState).toBe('WAITING_FOR_QUOTE_ACCEPTANCE');
    //     expect(StateMachine.__instance.state).toBe('quoteReceived');
    // });


    // test('halts and resumes after parties and quotes stages when AUTO_ACCEPT_PARTY is false and AUTO_ACCEPT_QUOTES is false', async () => {
    //     config.autoAcceptParty = false;
    //     config.autoAcceptQuotes = false;

    //     let model = new Model({
    //         cache,
    //         logger,
    //         ...config,
    //     });

    //     await model.initialize(JSON.parse(JSON.stringify(transferRequest)));

    //     expect(StateMachine.__instance.state).toBe('start');

    //     // start the model running
    //     let resultPromise = model.run();

    //     // now we started the model running we simulate a callback with the resolved party
    //     emitPartyCacheMessage(cache, payeeParty);

    //     // wait for the model to reach a terminal state
    //     let result = await resultPromise;

    //     console.log(`Result after resolve payee: ${util.inspect(result)}`);

    //     // check we stopped at payeeResolved state
    //     expect(result.currentState).toBe('WAITING_FOR_PARTY_ACCEPTANCE');
    //     expect(StateMachine.__instance.state).toBe('payeeResolved');

    //     const transferId = result.transferId;

    //     // load a new model from the saved state
    //     model = new Model({
    //         cache,
    //         logger,
    //         ...config,
    //     });

    //     await model.load(transferId);

    //     // check the model loaded to the correct state
    //     expect(StateMachine.__instance.state).toBe('payeeResolved');

    //     // now run the model again. this should trigger transition to quote request
    //     resultPromise = model.run();

    //     // now we started the model running we simulate a callback with the quote response
    //     cache.publish(`qt_${model.data.quoteId}`, JSON.stringify(quoteResponse));

    //     // wait for the model to reach a terminal state
    //     result = await resultPromise;

    //     console.log(`Result after request quote: ${util.inspect(result)}`);

    //     // check we stopped at quoteReceived state
    //     expect(result.currentState).toBe('WAITING_FOR_QUOTE_ACCEPTANCE');
    //     expect(StateMachine.__instance.state).toBe('quoteReceived');

    //     // load a new model from the saved state
    //     model = new Model({
    //         cache,
    //         logger,
    //         ...config,
    //     });

    //     await model.load(transferId);

    //     // check the model loaded to the correct state
    //     expect(StateMachine.__instance.state).toBe('quoteReceived');

    //     // now run the model again. this should trigger transition to quote request
    //     resultPromise = model.run();

    //     // now we started the model running we simulate a callback with the transfer fulfilment
    //     cache.publish(`tf_${model.data.transferId}`, JSON.stringify(transferFulfil));

    //     // wait for the model to reach a terminal state
    //     result = await resultPromise;

    //     console.log(`Result after transfer fulfil: ${util.inspect(result)}`);

    //     // check we stopped at quoteReceived state
    //     expect(result.currentState).toBe('COMPLETED');
    //     expect(StateMachine.__instance.state).toBe('succeeded');
    // });

    // test('uses payee party fspid for transfer prepare when config USE_QUOTE_SOURCE_FSP_AS_TRANSFER_PAYEE_FSP is false', async () => {
    //     config.autoAcceptParty = true;
    //     config.autoAcceptQuotes = true;
    //     config.useQuoteSourceFSPAsTransferPayeeFSP = false;

    //     MojaloopRequests.__getParties = jest.fn(() => {
    //         // simulate a callback with the resolved party
    //         emitPartyCacheMessage(cache, payeeParty);
    //         return Promise.resolve();
    //     });

    //     MojaloopRequests.__postQuotes = jest.fn((postQuotesBody) => {
    //         // simulate a callback with the quote response
    //         emitQuoteResponseCacheMessage(cache, postQuotesBody.quoteId, quoteResponse);
    //         return Promise.resolve();
    //     });

    //     MojaloopRequests.__postTransfers = jest.fn((postTransfersBody) => {
    //         //ensure that the `MojaloopRequests.postTransfers` method has been called with the correct arguments
    //         // set as the destination FSPID, picked up from the header's value `fspiop-source`
    //         expect(model.data.quoteResponseSource).toBe(quoteResponse.headers['fspiop-source']);
    //         expect(MojaloopRequests.__postTransfers).toHaveBeenCalledTimes(1);
    //         const payeeFsp = MojaloopRequests.__postTransfers.mock.calls[0][0].payeeFsp;
    //         expect(payeeFsp).toEqual(payeeParty.party.partyIdInfo.fspId);

    //         // simulate a callback with the transfer fulfilment
    //         emitTransferFulfilCacheMessage(cache, postTransfersBody.transferId, transferFulfil);
    //         return Promise.resolve();
    //     });

    //     const model = new Model({
    //         cache,
    //         logger,
    //         ...config,
    //     });

    //     await model.initialize(JSON.parse(JSON.stringify(transferRequest)));

    //     expect(StateMachine.__instance.state).toBe('start');

    //     // start the model running
    //     const resultPromise = model.run();

    //     // wait for the model to reach a terminal state
    //     const result = await resultPromise;

    //     console.log(`Result after three stage transfer: ${util.inspect(result)}`);

    //     // check we stopped at payeeResolved state
    //     expect(result.currentState).toBe('COMPLETED');
    //     expect(StateMachine.__instance.state).toBe('succeeded');
    // });

    // test('uses quote response source fspid for transfer prepare when config USE_QUOTE_SOURCE_FSP_AS_TRANSFER_PAYEE_FSP is true', async () => {
    //     config.autoAcceptParty = true;
    //     config.autoAcceptQuotes = true;
    //     config.useQuoteSourceFSPAsTransferPayeeFSP = true;

    //     MojaloopRequests.__getParties = jest.fn(() => {
    //         // simulate a callback with the resolved party
    //         emitPartyCacheMessage(cache, payeeParty);
    //         return Promise.resolve();
    //     });

    //     MojaloopRequests.__postQuotes = jest.fn((postQuotesBody) => {
    //         // simulate a callback with the quote response
    //         emitQuoteResponseCacheMessage(cache, postQuotesBody.quoteId, quoteResponse);
    //         return Promise.resolve();
    //     });

    //     MojaloopRequests.__postTransfers = jest.fn((postTransfersBody) => {
    //         //ensure that the `MojaloopRequests.postTransfers` method has been called with the correct arguments
    //         // set as the destination FSPID, picked up from the header's value `fspiop-source`
    //         expect(model.data.quoteResponseSource).toBe(quoteResponse.headers['fspiop-source']);
    //         expect(MojaloopRequests.__postTransfers).toHaveBeenCalledTimes(1);
    //         const payeeFsp = MojaloopRequests.__postTransfers.mock.calls[0][0].payeeFsp;
    //         expect(payeeFsp).toEqual(quoteResponse.headers['fspiop-source']);

    //         // simulate a callback with the transfer fulfilment
    //         emitTransferFulfilCacheMessage(cache, postTransfersBody.transferId, transferFulfil);
    //         return Promise.resolve();
    //     });

    //     const model = new Model({
    //         cache,
    //         logger,
    //         ...config,
    //     });

    //     await model.initialize(JSON.parse(JSON.stringify(transferRequest)));

    //     expect(StateMachine.__instance.state).toBe('start');

    //     // start the model running
    //     const resultPromise = model.run();

    //     // wait for the model to reach a terminal state
    //     const result = await resultPromise;

    //     console.log(`Result after three stage transfer: ${util.inspect(result)}`);

    //     // check we stopped at payeeResolved state
    //     expect(result.currentState).toBe('COMPLETED');
    //     expect(StateMachine.__instance.state).toBe('succeeded');
    // });

    // test('pass quote response `expiration` deadline', () =>
    //     testTransferWithDelay({
    //         expirySeconds: 2,
    //         delays: {
    //             requestQuotes: 1,
    //         },
    //         rejects: {
    //             quoteResponse: true,
    //         }
    //     })
    // );

    // test('pass transfer fulfills `expiration` deadline', () =>
    //     testTransferWithDelay({
    //         expirySeconds: 2,
    //         delays: {
    //             prepareTransfer: 1,
    //         },
    //         rejects: {
    //             transferFulfils: true,
    //         }
    //     })
    // );

    // test('pass all stages `expiration` deadlines', () =>
    //     testTransferWithDelay({
    //         expirySeconds: 2,
    //         delays: {
    //             requestQuotes: 1,
    //             prepareTransfer: 1,
    //         },
    //         rejects: {
    //             quoteResponse: true,
    //             transferFulfils: true,
    //         }
    //     })
    // );

    // test('fail on quote response `expiration` deadline', () =>
    //     testTransferWithDelay({
    //         expirySeconds: 1,
    //         delays: {
    //             requestQuotes: 2,
    //         },
    //         rejects: {
    //             quoteResponse: true,
    //         }
    //     })
    // );

    // test('fail on transfer fulfills `expiration` deadline', () =>
    //     testTransferWithDelay({
    //         expirySeconds: 1,
    //         delays: {
    //             prepareTransfer: 2,
    //         },
    //         rejects: {
    //             transferFulfils: true,
    //         }
    //     })
    // );

    // test('Throws with mojaloop error in response body when party resolution error callback occurs', async () => {
    //     config.autoAcceptParty = true;
    //     config.autoAcceptQuotes = true;

    //     MojaloopRequests.__getParties = jest.fn(() => {
    //         // simulate a callback with the resolved party
    //         cache.publish(genPartyId(payeeParty), JSON.stringify(expectError));
    //         return Promise.resolve();
    //     });

    //     const model = new Model({
    //         cache,
    //         logger,
    //         ...config,
    //     });

    //     await model.initialize(JSON.parse(JSON.stringify(transferRequest)));

    //     expect(StateMachine.__instance.state).toBe('start');

    //     const expectError = {
    //         errorInformation: {
    //             errorCode: '3204',
    //             errorDescription: 'Party not found'
    //         }
    //     };

    //     const errMsg = 'Got an error response resolving party: { errorInformation: { errorCode: \'3204\', errorDescription: \'Party not found\' } }';

    //     try {
    //         await model.run();
    //     }
    //     catch(err) {
    //         expect(err.message.replace(/[ \n]/g,'')).toEqual(errMsg.replace(/[ \n]/g,''));
    //         expect(err.transferState).toBeTruthy();
    //         expect(err.transferState.lastError).toBeTruthy();
    //         expect(err.transferState.lastError.mojaloopError).toEqual(expectError);
    //         expect(err.transferState.lastError.transferState).toBe(undefined);
    //         return;
    //     }

    //     throw new Error('Outbound model should have thrown');
    // });


    // test('Throws with mojaloop error in response body when quote request error callback occurs', async () => {
    //     config.autoAcceptParty = true;
    //     config.autoAcceptQuotes = true;

    //     const expectError = {
    //         type: 'quoteResponseError',
    //         data: {
    //             errorInformation: {
    //                 errorCode: '3205',
    //                 errorDescription: 'Quote ID not found'
    //             }
    //         }
    //     };


    //     MojaloopRequests.__getParties = jest.fn(() => {
    //         // simulate a callback with the resolved party
    //         emitPartyCacheMessage(cache, payeeParty);
    //         return Promise.resolve();
    //     });

    //     MojaloopRequests.__postQuotes = jest.fn((postQuotesBody) => {
    //         // simulate a callback with the quote response
    //         cache.publish(`qt_${postQuotesBody.quoteId}`, JSON.stringify(expectError));
    //         return Promise.resolve();
    //     });

    //     const model = new Model({
    //         cache,
    //         logger,
    //         ...config,
    //     });

    //     await model.initialize(JSON.parse(JSON.stringify(transferRequest)));

    //     expect(StateMachine.__instance.state).toBe('start');

    //     const errMsg = 'Got an error response requesting quote: { errorInformation:\n   { errorCode: \'3205\', errorDescription: \'Quote ID not found\' } }';

    //     try {
    //         await model.run();
    //     }
    //     catch(err) {
    //         expect(err.message.replace(/[ \n]/g,'')).toEqual(errMsg.replace(/[ \n]/g,''));
    //         expect(err.transferState).toBeTruthy();
    //         expect(err.transferState.lastError).toBeTruthy();
    //         expect(err.transferState.lastError.mojaloopError).toEqual(expectError.data);
    //         expect(err.transferState.lastError.transferState).toBe(undefined);
    //         return;
    //     }

    //     throw new Error('Outbound model should have thrown');
    // });


    // test('Throws with mojaloop error in response body when transfer request error callback occurs', async () => {
    //     config.autoAcceptParty = true;
    //     config.autoAcceptQuotes = true;

    //     const expectError = {
    //         type: 'transferError',
    //         data: {
    //             errorInformation: {
    //                 errorCode: '4001',
    //                 errorDescription: 'Payer FSP insufficient liquidity'
    //             }
    //         }
    //     };

    //     MojaloopRequests.__getParties = jest.fn(() => {
    //         // simulate a callback with the resolved party
    //         emitPartyCacheMessage(cache, payeeParty);
    //         return Promise.resolve();
    //     });

    //     MojaloopRequests.__postQuotes = jest.fn((postQuotesBody) => {
    //         // simulate a callback with the quote response
    //         emitQuoteResponseCacheMessage(cache, postQuotesBody.quoteId, quoteResponse);
    //         return Promise.resolve();
    //     });

    //     MojaloopRequests.__postTransfers = jest.fn((postTransfersBody) => {
    //         // simulate an error callback with the transfer fulfilment
    //         cache.publish(`tf_${postTransfersBody.transferId}`, JSON.stringify(expectError));
    //         return Promise.resolve();
    //     });

    //     const model = new Model({
    //         cache,
    //         logger,
    //         ...config,
    //     });

    //     await model.initialize(JSON.parse(JSON.stringify(transferRequest)));

    //     expect(StateMachine.__instance.state).toBe('start');

    //     const errMsg = 'Got an error response preparing transfer: { errorInformation:\n   { errorCode: \'4001\',\n     errorDescription: \'Payer FSP insufficient liquidity\' } }';

    //     try {
    //         await model.run();
    //     }
    //     catch(err) {
    //         expect(err.message.replace(/[ \n]/g,'')).toEqual(errMsg.replace(/[ \n]/g,''));
    //         expect(err.transferState).toBeTruthy();
    //         expect(err.transferState.lastError).toBeTruthy();
    //         expect(err.transferState.lastError.mojaloopError).toEqual(expectError.data);
    //         expect(err.transferState.lastError.transferState).toBe(undefined);
    //         return;
    //     }

    //     throw new Error('Outbound model should have thrown');
    // });


    async function testTlsServer(enableTls) {
        config.tls.outbound.mutualTLS.enabled = enableTls;

        new Model({
            cache,
            logger,
            ...config
        });

        const scheme = enableTls ? 'https' : 'http';
        expect(MojaloopRequests.__instance.transportScheme).toBe(scheme);
    }

    // test('Outbound server should use HTTPS if outbound mTLS enabled', () =>
    //     testTlsServer(true));

    // test('Outbound server should use HTTP if outbound mTLS disabled', () =>
    //     testTlsServer(false));
});
