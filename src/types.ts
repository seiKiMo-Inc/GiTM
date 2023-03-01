import { Kcp } from "kcp-ts";

import console from "@app/logger";
import { keys } from "@app/constants";
import { establishClient } from "@app/translate";

export type NetworkInfo = {
    address: string;
    port: number;
    conv: number;
    id: string;
};

export type ServerInfo = {
    client: Kcp; // KCP client to server.
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

    constructor(
        public readonly handle: Kcp,
        public readonly network: NetworkInfo
    ) {
        // Log the connection.
        console.log(`Client connected: ${network.id}.`);

        // Initialize a server client.
        establishClient(this);
    }

    /**
     * Sends a packet to the server.
     * @param packet The packet to send.
     */
    sendToServer(packet: Buffer): void {
        if (this.server == null) return;

        // Check if the server is initialized.
        if (this.server.initialized) {
            // Forward the packet to the server.
            this.server.client.send(packet);
        } else {
            // Push the packet onto a queue.
            this.server.queue.push(packet);
        }
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
        return this.server ? this.server.encryptKey : keys.initial;
    }
}