import { KCP } from "node-kcp-x";

export type NetworkInfo = {
    address: string;
    port: number;
    id: string;
};

export type PacketIds = { [key: string|number]: number|string };

export class Handshake {
    static MAGIC_CONNECT = [0xFF, 0xFFFFFFFF];
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

    constructor(
        public readonly handle: KCP,
        public readonly network: NetworkInfo
    ) { }
}