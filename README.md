# stompit2

stompit2 is a STOMP client library for Node.js and front-end apps. The most notable feature is the 
asynchronous pull API for receiving messages. The application controls when it receives the next 
message and the library returns a Promise for the operation. Similarly payload I/O is driven by 
the application. Asynchronous iterators of `UInt8Array` are used to transfer chunks of a frame's 
payload in both reading and writing operations. The library avoids using the `EventEmitter` 
interface.

TypeScript definitions are included in the library package.
