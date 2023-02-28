import console from "@app/logger";
import { network, keys } from "@app/constants";
import { Client, Handshake } from "@app/types";
import * as utils from "@app/utils";

import { KCP } from "node-kcp-x";
import type { RemoteInfo } from "node:dgram";

const kcpTokens: { [key: string]: number } = {};
const connected: { [key: string]: Client } = {};
const outTokens: { [key: string]: number } = {};

/* Create an IPv4 UDP socket. */
import { createSocket } from "node:dgram";
const socket = createSocket("udp4");

/**
 * Creates a unique network ID.
 * @param data The data received from the client.
 * @param remote The remote address and port.
 */
function networkId(data: Buffer, remote: RemoteInfo): string {
    return `${remote.address}_${remote.port}_${data.readUInt32LE(0).toString(16)}`;
}

/**
 * Performs a handshake with a client.
 * @param id The client's network ID.
 * @param data The data received from the client.
 * @param type The type of handshake to perform.
 */
function doHandshake(id: string, data: Buffer, type: number): Handshake {
    switch (type) {
        case 0xFF: // Incoming connection.
            // Create a copy of the buffer.
            const buffer = Buffer.from(data);
            // Perform an initial decode.
            const handshake = new Handshake();
            handshake.decode(buffer);

            // Generate handshake response data.
            const conversation = Date.now();
            const token = kcpTokens[id] = 0xFFCCEEBB ^ ((Date.now() >> 0) & 0xFFFFFFFF);

            return new Handshake(Handshake.INITIALIZE, conversation, token);
        case 0x194: // Incoming disconnection.
            return new Handshake(Handshake.DISCONNECT);
        default:
            console.warn(`Unknown handshake type: ${type}.`);
            return new Handshake();
    }
}

/**
 * Handles an incoming message.
 */
async function handleMessage(msg: Buffer, remote: RemoteInfo) {
    const id = networkId(msg, remote); // Create a unique network ID.
    const buffer = Buffer.from(msg); // Create a copy of the buffer.

    // Check for a KCP handshake.
    if (buffer.byteLength <= 20) {
        const handshake = doHandshake(id, buffer, buffer.readInt32BE(0));
        const response = handshake.encode();

        console.debug(`handshake from ${id}`);

        return socket.send(response, 0,
            response.byteLength, remote.port, remote.address);
    }

    console.debug(`message from ${id}`)

    // Get the connected client.
    const client = connected[id] ?? (() => {
        const kcp = new KCP(buffer.readUInt32LE(0), remote);
        kcp.nodelay(1, 10, 2, 1);
        kcp.output(() => null);
        return connected[id] = new Client(kcp, { ...remote, id });
    })();

    // Read the output token for the client.
    const outToken = outTokens[id] = buffer.readUInt32LE(4);
    // Update the KCP connection with the received data.
    client.handle.input(utils.readPacket(buffer));
    client.handle.update(Date.now());

    // Handle a received KCP message.
    const packet = client.handle.recv();
    if (packet == undefined) return;
    console.log(`received packet from ${id}`)

    // Duplicate the packet.
    const data = Buffer.from(packet);
    // Decrypt the packet.
    utils.xor(data, client.post ? keys.post : keys.initial);

    // Validate the packet.
    if (!(
        data.length > 5 && data.readInt16BE(0) == 0x4567 &&
        data.readUInt16BE(data.byteLength - 2) == 0x89AB
    )) return;

    // Read the packet's data.
    const packetId = data.readInt16BE(2);
    const packetData = utils.parsePacket(data);

    console.log(`Received packet: ${packetId}`)
}

/* Set socket event listeners. */
socket.on("message", handleMessage);
/* Bind to the specified port. */
socket.bind(network.port, () =>  {
    const address = socket.address();
    console.log(`UDP server listening on ${address.address}:${address.port}.`)
});