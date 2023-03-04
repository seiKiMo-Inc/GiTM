import { Kcp } from "kcp-ts";
import { Socket } from "node:dgram";

import console from "@app/logger";
import { keys, network } from "@app/constants";
import { establishClient } from "@app/translate";

export type NetworkInfo = {
    address: string;
    port: number;
    conv: number;
    id: string;
};

export type ServerInfo = {
    client: Kcp; // KCP client to server.
    socket: Socket; // UDP socket to server.
    encryptKey: Buffer; // Encryption key.
    initialized: boolean; // Whether handshake has been received.
    conv: number; // Conversation ID to use.
    token: number; // Token to use.
    queue: Buffer[]; // Queue of packets to send.
};

export type PacketIds = { [key: string|number]: number|string };

export enum Protocol {
    UNKNOWN = -1,
    REL3_2 = 0,
    REL3_3 = 1,
}

export class Handshake {
    static CONNECT = [0xFF, 0xFFFFFFFF];
    static INITIALIZE = [0x145, 0x14514545];
    static DISCONNECT = [0x194, 0x19419494];

    magic1: number;
    magic2: number;
    buffer: Buffer | number;

    constructor(
        magic = [0x0, 0x0],
        public conv = 0,
        public token = 0,
        public data = 0
    ) {
        this.magic1 = magic[0];
        this.magic2 = magic[1];
        this.buffer = 0;
    }

    /**
     * Decodes the handshake from a buffer.
     * @param data The buffer to decode.
     */
    public decode(data: Buffer): void {
        const dataBuffer = Buffer.from(data);

        // Read the handshake data.
        this.magic1 = dataBuffer.readUInt32BE(0);
        this.conv = dataBuffer.readUInt32BE(4);
        this.token = dataBuffer.readUInt32BE(8);
        this.data = dataBuffer.readUInt32BE(12);
        this.magic2 = dataBuffer.readUInt32BE(16);

        this.buffer = dataBuffer;
    }

    /**
     * Encodes the handshake into a buffer.
     */
    public encode(): Buffer {
        // Create a new handshake.
        const buffer = Buffer.alloc(20);

        buffer.writeUInt32BE(this.magic1, 0);
        buffer.writeUInt32BE(1, 4);
        buffer.writeUInt32BE(1, 8);
        buffer.writeUInt32BE(this.data, 12);
        buffer.writeUInt32BE(this.magic2, 16);

        return this.buffer = buffer;
    }
}

export class Client {
    public post: boolean = false;
    public protocol: Protocol = -1;
    public server: ServerInfo = null;

    public readonly clientQueue: Array<Buffer> = [];
    public readonly serverQueue: Array<Buffer> = [];

    constructor(
        public readonly handle: Kcp,
        public readonly network: NetworkInfo,
        private readonly rawInput: (data: Buffer) => void
    ) {
        // Log the connection.
        console.log(`Client connected: ${network.id}.`);

        // Initialize a server client.
        establishClient(this);
        // Initialize the update loop.
        this.update();
    }

    /**
     * Updates the KCP client.
     */
    update(after = 0): void {
        if (!this.handle) return;

        setTimeout(() => {
            const current = Date.now();
            this.handle.update(current);
            this.update(this.handle.check(current));
            this.handle.flush();
        }, after);
    }

    /**
     * Sends a packet to the server.
     * @param packet The packet to send.
     * @param raw Whether to send the packet raw.
     */
    sendToServer(packet: Buffer, raw = false): void {
        if (this.server == null) {
            console.warn("Client is attempting to send packets to an unconnected server!");
            return;
        }

        if (raw) {
            return this.server.socket.send(
                packet, network.server.port, network.server.address);
        }

        // Check if the server is initialized.
        if (this.server.initialized) {
            // Forward the packet to the server.
            this.server.client.send(packet);
            // Update & flush the client.
            this.server.client.update(Date.now());
            this.server.client.flush();
        } else {
            // Push the packet onto a queue.
            this.server.queue.push(packet);
            console.debug(`Queued packet for ${this.network.id}.`);
        }
    }

    /**
     * Sends a packet to the client.
     * @param packet The packet to send.
     * @param raw Whether to send the packet raw.
     */
    sendToClient(packet: Buffer, raw = false): void {
        if (this.handle == null) {
            console.warn("Server is attempting to send packets to an unconnected client!");
            return;
        }

        // Send the packet to the client.
        if (raw) {
            this.rawInput(packet);
        } else {
            this.handle.send(packet);
            this.handle.flush();
        }
    }

    /**
     * Initializes the connection with the server.
     * @param handshake The KCP handshake received.
     * @param socket
     */
    initializeServerConnection(handshake: Handshake, socket: Socket): Kcp {
        // Set the client as initialized.
        this.server.initialized = true;
        // Set the client's KCP data.
        this.server.token = handshake.token;
        this.server.conv = handshake.conv;

        console.debug(`Established a connection with the server.`);
        console.debug(`Conv: ${this.server.conv}; Token: ${this.server.token};`);

        // Create a KCP instance.
        const kcp = new Kcp(
            this.server.conv,
            this.server.token,
            (data) => socket.send(data,
                network.server.port, network.server.address)
        );
        // Configure the KCP socket.
        kcp.setMtu(1200);
        kcp.setWndSize(1024, 1024);
        kcp.setNodelay(true, 1, false);
        // Set the KCP instance.
        this.server.client = kcp;

        // Send any queued data.
        setTimeout(() => {
            this.server.queue.forEach((data) => {
                kcp.send(data);
            });
        }, 1e3);

        return kcp; // Return the KCP instance.
    }

    /**
     * Checks if the server is initialized.
     */
    get initialized(): boolean {
        return this.server ? this.server.initialized : false;
    }

    /**
     * Returns the appropriate encryption key.
     */
    get encryptKey(): Buffer {
        return this.server || this.post ?
            this.server.encryptKey :
            keys.initial;
    }

    /**
     * Iterate over the server packet queue.
     */
    *[Symbol.iterator]() {
        let packet; while (packet = this.serverQueue.shift())
            yield packet;
    }
}

export class MT19937_64 {
    private readonly mt: bigint[];
    private mti: number;

    constructor() {
        this.mt = new Array(312).fill(0n);
        this.mti = 313;
    }

    public seed(seed: bigint) {
        this.mt[0] = seed & 0xffffffffffffffffn;

        for (let i = 1; i < 312; i++) {
            this.mt[i] =
                (6364136223846793005n * (this.mt[i - 1]! ^ (this.mt[i - 1]! >> 62n)) + BigInt(i)) & 0xffffffffffffffffn;
        }

        this.mti = 312;
    }

    public next() {
        if (this.mti >= 312) {
            if (this.mti == 313) {
                this.seed(5489n);
            }

            for (let k = 0; k < 311; k++) {
                const y = (this.mt[k]! & 0xffffffff80000000n) | (this.mt[k + 1]! & 0x7fffffffn);

                if (k < 312 - 156) {
                    this.mt[k] = this.mt[k + 156]! ^ (y >> 1n) ^ ((y & 1n) == 0n ? 0n : 0xb5026f5aa96619e9n);
                } else {
                    this.mt[k] =
                        this.mt[k + 156 - 624 + this.mt.length]! ^ (y >> 1n) ^ ((y & 1n) == 0n ? 0n : 0xb5026f5aa96619e9n);
                }
            }

            const yy = (this.mt[311]! & 0xffffffff80000000n) | (this.mt[0]! & 0x7fffffffn);

            this.mt[311] = this.mt[155]! ^ (yy >> 1n) ^ ((yy & 1n) == 0n ? 0n : 0xb5026f5aa96619e9n);
            this.mti = 0;
        }

        let x = this.mt[this.mti]!;
        this.mti += 1;

        x ^= (x >> 29n) & 0x5555555555555555n;
        x ^= (x << 17n) & 0x71d67fffeda60000n;
        x ^= (x << 37n) & 0xfff7eee000000000n;
        x ^= x >> 43n;

        return x;
    }
}