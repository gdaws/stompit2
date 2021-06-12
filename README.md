# stompit2

[![Build Status](https://travis-ci.com/gdaws/stompit2.svg?branch=master)](https://travis-ci.com/gdaws/stompit2)
[![codecov](https://codecov.io/gh/gdaws/stompit2/branch/master/graph/badge.svg)](https://codecov.io/gh/gdaws/stompit2)

stompit2 is a STOMP client library for Node.js and front-end apps. The most notable feature is the 
asynchronous pull API for receiving messages. The application controls when it receives the next 
message and the library returns a Promise for the operation. Similarly payload I/O is driven by 
the application. Asynchronous iterators of `UInt8Array` are used to transfer chunks of a frame's 
payload in both reading and writing operations. The library avoids using the `EventEmitter` 
interface.

TypeScript definitions are included in the library package.

## Install

There is a separate package for each supported runtime environment.

To use the library in a Node.js app install package:

```sh
npm install stompit2-node
```

Requires Node version >=14.17.0. The package is compiled from Typescript and targeted for Node 14. 
The library does support earlier versions of Node but I choose not to distribute multiple optimised 
packages.

To use the library in a web browser install package:

```sh
npm install stompit2-web
```

Compiled to ES6 code and as ES6 modules.

## Usage

### Client Session Life Cycle

1. Create a transport connection: call `netConnect`, `tlsConnect` or `wsConnect`
2. Establish a STOMP session with the server: call `stompConnect`
3. Send and receive messages
4. Close session: `session.disconnect()`

Functions:

* [netConnect](https://gdaws.github.io/stompit2/master/modules/_src_transport_netsocketstream_.html#netconnect)
* [tlsConnect](https://gdaws.github.io/stompit2/master/modules/_src_transport_tlssocketstream_.html#tlsconnect)
* [wsConnect](https://gdaws.github.io/stompit2/master/modules/_src_transport_websocketstream_.html#wsconnect)
* [stompConnect](https://gdaws.github.io/stompit2/master/modules/_src_index_.html#stompconnect)
* [disconnect](https://gdaws.github.io/stompit2/master/classes/_src_client_session_.clientsession.html#disconnect)

### Sending Messages

1. Construct the frame headers: use `FrameHeaders.fromEntries` or `FrameHeaders.fromMap`
2. Construct a frame body generator: e.g. using a helper function `writeString`, `writeJson` or `writeBuffer` etc
3. Construct a frame object, referencing the headers and the body: e.g. `{command: 'SEND', headers, body}`
4. Send the message: `session.send(frame)`

Functions:

* [FrameHeaders.fromEntries](https://gdaws.github.io/stompit2/master/classes/_src_frame_header_.frameheaders.html#fromentries)
* [FrameHeaders.fromMap](https://gdaws.github.io/stompit2/master/classes/_src_frame_header_.frameheaders.html#frommap)
* [writeString](https://gdaws.github.io/stompit2/master/modules/_src_frame_body_.html#writestring)
* [writeJson](https://gdaws.github.io/stompit2/master/modules/_src_frame_body_.html#writejson)
* [writeBuffer](https://gdaws.github.io/stompit2/master/modules/_src_frame_body_.html#writebuffer)
* [send](https://gdaws.github.io/stompit2/master/classes/_src_client_session_.clientsession.html#send)

### Receiving Messages

1. Open a subscription: `session.subscribe('/queue/test', 'client-individual')`
2. Receive a message: `session.receive(subscription)`
3. Read the message content: e.g. `readString(message.body)` (or use helper function `readJson`)
4. Once the message is processed send an acknowledgment: `session.ack(message.headers.get('message-id'))`
5. Goto step 2 or close the subscription (by calling unsubscribe or closing the session)

Functions:

* [subscribe](https://gdaws.github.io/stompit2/master/classes/_src_client_session_.clientsession.html#subscribe)
* [receive](https://gdaws.github.io/stompit2/master/classes/_src_client_session_.clientsession.html#receive)
* [cancelReceive](https://gdaws.github.io/stompit2/master/classes/_src_client_session_.clientsession.html#cancelreceive)
* [readString](https://gdaws.github.io/stompit2/master/modules/_src_frame_body_.html#readstring)
* [readJson](https://gdaws.github.io/stompit2/master/modules/_src_frame_body_.html#readjson)
* [ack](https://gdaws.github.io/stompit2/master/classes/_src_client_session_.clientsession.html#ack)
* [nack](https://gdaws.github.io/stompit2/master/classes/_src_client_session_.clientsession.html#nack)
* [unsubscribe](https://gdaws.github.io/stompit2/master/classes/_src_client_session_.clientsession.html#unsubscribe)
* [messageQueue](https://gdaws.github.io/stompit2/master/modules/_src_client_subscription_.html)

Reading the message content from the frame payload must not be deferred if it's to let subsequent frames 
be received first, as doing so blocks the session and starves other subscriptions. However fully read 
messages can be deferred and pushed into a local queue for later processing.

Calling the subscribe method is optional. If your subscribe request requires non-standard headers then you can
construct and send your own SUBSCRIBE frame and then be ready to receive messages. To use the receive method, 
you need to construct a subscription object using the same details in your SUBSCRIBE frame.

To receive from pre-established subscriptions, like for example if you're using Rabbitmq's temp queue 
destinations, then you don't need to send a subscribe request, instead construct a subscription object with
the expected properties and call receive. Side note: the library provides a convenient helper function [request](https://gdaws.github.io/stompit2/master/modules/_src_rabbitmq_.html#request)
in the rabbitmq module to handle the request-response pattern.

A receive operation can be cancelled directly (i.e. `session.cancelReceive(subscription)`) or indirectly
by a successful disconnect.

## Error Handling

The library doesn't use exceptions where possible and instead most functions return a `Result` object 
to pass a return value or error. To make the library more convenient to use in applications that use 
exception handling, the `result` function is provided to unwrap the return value or throw an exception
if the result status is not `RESULT_OK`.

A client session object doesn't emit events. If any error occurs then the error value is returned from
the affected operations.

## Transport Limit Defaults

It's a good idea for your application to impose size and time limits on I/O operations, although if you
wish, all the limit parameters used by the transport can be effectively disabled. The transport module 
exports a `limitDefaults` object and is the default value for the `limits` parameter of the 
`StandardTransport` constructor.

STOMP heart-beating is configured with the `desiredReadRate` and `desiredWriteRate` properties.

* `limitDefaults.operationTimeout: 3000`
* `limitDefaults.desiredReadRate: 3000`
* `limitDefaults.desiredWriteRate: 0`
* `limitDefaults.delayTolerance: 3000`
* `limitDefaults.readLimits.maxHeaderLines: 128`
* `limitDefaults.readLimits.maxLineLength: 8000`
* `limitDefaults.readLimits.maxBodyLength: Infinity`
* `limitDefaults.readLimits.maxBodyChunkLength: 16384`
* `limitDefaults.writeLimits.bufferSize: 16384`
