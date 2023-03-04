import console from "@app/logger";
import { network, keys } from "@app/constants";
import { Client, Handshake } from "@app/types";
import * as utils from "@app/utils";

import { getConv, getToken, Kcp } from "kcp-ts";
import type { RemoteInfo } from "node:dgram";

const kcpTokens: { [key: string]: number } = {};
const connected: { [key: string]: Client } = {};
const outTokens: { [key: string]: number } = {};

/* Create an IPv4 UDP socket. */
import { createSocket } from "node:dgram";
import { fromClient } from "@app/translate";
export const server = createSocket("udp4");

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
 * Sends data to a client.
 * @param remote The location to send the data to.
 * @param data The data to send.
 */
function sendToClient(remote: RemoteInfo, data: Buffer): void {
    if (data == undefined) return;

    // Forward the data to the client.
    server.send(data, remote.port, remote.address);
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

        return server.send(response, remote.port, remote.address);
    }

    // Get the connected client.
    const client = connected[id] ?? (() => {
        const conv = getConv(buffer);
        const token = getToken(buffer);

        // Initialize a KCP client handler.
        const kcp = new Kcp(conv, token, (data: Buffer) => {
            const buffer = Buffer.from(data); // Create a copy of the buffer.
            sendToClient(remote, buffer); // Send the data to the client.
        });
        return connected[id] = new Client(kcp, { ...remote, id, conv },
            (data: Buffer) => sendToClient(remote, data));
    })();

    // Read the output token for the client.
    outTokens[id] = getToken(buffer);
    // Update the KCP connection with the received data.
    const result = client.handle.input(buffer);
    if (result < 0) {
        const kcp = client.handle;
        console.warn(`KCP input error: ${result}.`);
        console.info(buffer.length, kcp.conv, kcp.token,
            getConv(buffer), getToken(buffer));
        return;
    }

    // Handle a received KCP message.
    const size = client.handle.peekSize();
    if (size < 0) return;

    const recvBuffer = Buffer.alloc(size);
    const packet = client.handle.recv(recvBuffer);
    if (packet < 0) return;

    // Duplicate the packet.
    const data = Buffer.from(recvBuffer);

    // Decrypt the packet.
    utils.xor(data, client.encryptKey);

    // Validate the packet.
    if (!utils.isValidPacket(data)) {
        // Re-do the XOR.
        utils.xor(data, client.encryptKey);
        // Attempt to XOR with the initial key.
        utils.xor(data, keys.initial);
        // Check if the packet is valid.
        if (utils.isValidPacket(data)) {
            console.warn("The server hasn't switched keys yet!");
        } else {
            console.warn("Invalid packet received from client.");
            return;
        }
    }

    // Read the packet's data.
    const packetId = data.readInt16BE(2);
    const packetData = utils.parsePacket(data);
    const packetHeader = utils.parseHeader(data);

    // Handle the packet.
    fromClient(client, packetId, packetData, packetHeader)
        .catch(err => console.error(err));
}

/* Set socket event listeners. */
server.on("message", handleMessage);
/* Bind to the specified port. */
server.bind(network.port, () =>  {
    const address = server.address();
    console.log(`UDP server listening on ${address.address}:${address.port}.`);
    console.log(`Sending packets to ${network.server.address}:${network.server.port}.`);
});