import { keys, network, protocol } from "@app/constants";
import { Client, Handshake, Protocol, ServerInfo } from "@app/types";
import * as utils from "@app/utils";

import { Kcp } from "kcp-ts";
import { createSocket } from "node:dgram";

/**
 * Creates a new client instance.
 */
export function establishClient(client: Client): ServerInfo {
    // Create a new socket.
    const socket = createSocket("udp4");

    socket.on("message", (data: Buffer) => {
        // Check for handshake.
        if (data.byteLength == 20) {
            // Parse the handshake.
            const handshake = new Handshake();
            handshake.decode(data);

            // Check if the handshake is a connection.
            if (handshake.magic1 != 0x145 || handshake.magic2 != 0x14514545) {
                socket.close(() => console.warn("Invalid handshake received."));
            } else {
                // Set the client as initialized.
                client.server.initialized = true;
                // Set the client's KCP data.
                client.server.token = handshake.token;
                client.server.conv = handshake.conv;

                // Create a KCP instance.
                const kcp = new Kcp(
                    client.server.conv,
                    client.server.token,
                    (data) => socket.send(data, 0, data.byteLength,
                        network.server.port, network.server.address)
                );
                // Configure the KCP socket.
                kcp.setMtu(1200);
                kcp.setWndSize(1024, 1024);
                // Set the KCP instance.
                client.server.client = kcp;

                // Send any queued data.
                for (const data of client.server.queue)
                    kcp.send(data);
            }
        }

        // Check if the client is initialized.
        if (client.initialized) {
            // Send the data to the KCP instance.
            client.server.client.input(data);
        }
    });
    // Set an interval to update the KCP instance.
    const recvBuffer = Buffer.alloc(0x20000);
    setInterval(() => {
        const server = client.server;
        if (server == undefined) return;
        const kcpClient = server.client;

        // Update the KCP instance.
        kcpClient.update(Date.now());

        // Receive any data from the server.
        const received = kcpClient.recv(recvBuffer);
        if (received > 0) fromServer(client, recvBuffer.slice(0, received))
            .catch((err) => console.error(err));
    }, 100);

    // Send the handshake to the server.
    const conversation = client.network.conv;
    const handshake = new Handshake(Handshake.CONNECT,
        conversation, 67108945, 1234567890);
    const handshakeData = handshake.encode();
    socket.send(handshakeData, 0, handshakeData.byteLength,
        network.server.port, network.server.address);

    // Return the server information.
    return client.server = {
        client: null,
        encryptKey: keys.initial,
        initialized: false,
        conv: conversation,
        token: 0,
        queue: [],
    };
}

/**
 * Handles inbound data from the server.
 * Performs parsing and translation.
 * @param client The client instance.
 * @param data The data received from the server.
 */
export async function fromServer(
    client: Client,
    data: Buffer
): Promise<void> {
    console.log("received packet from server")
}

/**
 * Handles inbound data from the client.
 * Performs translation.
 * @param client The client instance.
 * @param id The client's network ID.
 * @param data The data received from the client.
 */
export async function fromClient(
    client: Client,
    id: number,
    data: Buffer
): Promise<void> {
    // Check if the client has a version.
    if (client.protocol == Protocol.UNKNOWN) {
        // Attempt to match the version.
        client.protocol = protocol.versions[id] ?? Protocol.UNKNOWN;
    } const version = client.protocol;

    // Get the identifiers for the packet.
    const name = protocol.bindings[version][id] as string;
    if (name == undefined) throw new Error("Unknown packet ID.");
    const translatedId = protocol.bindings[Protocol.REL3_2][name] as number;
    if (translatedId == undefined) throw new Error("Unknown packet name.");

    // Parse the data into a protocol buffer.
    const parsed = await utils.fromProto(data, name, version);
    if (parsed == undefined) throw new Error("Failed to parse packet.");

    // Translate the packet.
    const translated = await utils.toProto(parsed, name, Protocol.REL3_2);
    if (translated == undefined) throw new Error("Failed to translate packet.");

    // Send the packet to the server.
    const encoded = await utils.encodePacket(translated, translatedId,
        client.post ? client.encryptKey : keys.initial);
    if (encoded == undefined) throw new Error("Failed to encode packet.");

    // Send the packet to the server.
    client.sendToServer(encoded);
}