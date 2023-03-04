import { keys, logger, network, protocol } from "@app/constants";
import { Client, Handshake, Protocol, ServerInfo } from "@app/types";
import * as utils from "@app/utils";
import console from "@app/logger";

import { createSocket } from "node:dgram";

const sharedBuffer = Buffer.alloc(1 << 16);

/**
 * Creates a new client instance.
 */
export function establishClient(client: Client): ServerInfo {
    // Create a new socket.
    const socket = createSocket("udp4", (data: Buffer) => {
        // Check for handshake.
        if (data.byteLength == 20) {
            // Parse the handshake.
            const handshake = new Handshake();
            handshake.decode(data);

            // Check if the handshake is a connection.
            if (handshake.magic1 != 0x145 ||
                handshake.magic2 != 0x14514545
            ) {
                socket.close(() => {
                    console.warn("Non-connect handshake received.");
                    console.debug(`Handshake: ${handshake.magic1}:${handshake.magic2}`);
                    client.sendToClient(data, true);
                });
            } else {
                // Initialize the client.
                client.initializeServerConnection(handshake, socket);

                // Start the processing loop.
                setInterval(() => {
                    // Iterate over the server queue.
                    for (const packet of client) {
                        fromServer(client, packet)
                            .catch(err => console.error(err));
                    }
                }, 50);

                console.log(`Client ${client.network.id} established a connection.`)
            }
        } else if (client.initialized) {
            setTimeout(() => {
                const kcpClient = client.server.client;
                // Input the packet into the KCP instance.
                const result = kcpClient.input(Buffer.from(data));
                if (result < 0) {
                    console.warn(`Failed to input packet into KCP instance: ${result}`);
                    return;
                }

                // Update the KCP instance.
                kcpClient.update(Date.now());
                kcpClient.flush();

                for (;;) {
                    // Read the packet from the KCP instance.
                    const read = kcpClient.recv(sharedBuffer);
                    if (read < 0) break;

                    const buffer = Buffer.from(sharedBuffer.slice(0, read));
                    client.serverQueue.push(buffer); // Add the packet to the queue.
                }
            }, 0);
        }
    });

    // Send the handshake to the server.
    const conversation = client.network.conv;
    const handshake = new Handshake(Handshake.CONNECT,
        conversation, 0, 1234567890);
    const handshakeData = handshake.encode();
    socket.send(handshakeData, network.server.port, network.server.address);

    // Return the server information.
    return client.server = {
        client: null,
        socket: socket,
        encryptKey: keys.initial,
        initialized: false,
        conv: conversation,
        token: 0,
        queue: [],
    };
}

/**
 * Invokes the modifier for the packet.
 * @param object The packet object. Before translation.
 * @param client The client instance sending the packet.
 * @param name The name of the packet.
 */
export async function invokeModifier(
    object: any, client: Client, name: string
): Promise<void> {
    try {
        // Get the modifier for the packet.
        const modifier = await import(`./mods/${name}.ts`);
        // Invoke the modifier.
        modifier && await modifier.default(object, client);
    } catch { }
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
    // Duplicate the packet.
    const buffer = Buffer.from(data);
    // Decrypt the packet.
    utils.xor(buffer, client.encryptKey);

    // Validate the packet.
    if (!utils.isValidPacket(buffer)) {
        console.warn("Invalid packet received from server.");
        console.debug(`Size: ${buffer.byteLength} Header: ${buffer.readInt16BE(0)} Footer: ${buffer.readUInt16BE(buffer.byteLength - 2)}`);
        if (buffer.readInt16BE(0) == 0x4567) {
            console.debug(`Packet has a valid header! Dumping to console...`);
            console.debug((buffer as Buffer).toString("base64"));
        }
        return;
    }

    // Read the packet's data.
    const packetId = buffer.readInt16BE(2);
    const packetData = utils.parsePacket(buffer);

    // Get the identifiers for the packet.
    const name = protocol
        .bindings[Protocol.REL3_2]
        .backwards[packetId] as string;
    if (name == undefined) throw new Error("Unknown packet ID.");

    const translatedId = protocol
        .bindings[client.protocol]
        .forwards[name] as number;
    if (translatedId == undefined) throw new Error("Unknown packet name.");

    // Parse the data into a protocol buffer.
    const parsed = await utils.fromProto(packetData, name, Protocol.REL3_2);
    if (parsed == undefined) throw new Error("Failed to parse packet data.");

    // Invoke the modifier.
    await invokeModifier(parsed, client, name);

    // Translate the packet.
    const translated = await utils.toProto(parsed, name, client.protocol);
    if (translated == undefined) throw new Error("Failed to translate packet data.");

    // Send the packet to the client.
    const encoded = await utils.encodePacket(translated, translatedId,
        name == "GetPlayerTokenRsp" ? keys.initial : client.encryptKey);
    if (encoded == undefined) throw new Error("Failed to encode packet data.");
    // if (!logger.blacklist.includes(name)) {
        console.debug(`<< Translated packet ${name} (${packetId} -> ${translatedId})`);
    // }

    client.sendToClient(encoded);
}

/**
 * Handles inbound data from the client.
 * Performs translation.
 * @param client The client instance.
 * @param id The client's network ID.
 * @param data The data received from the client.
 * @param header The header of the original packet.
 */
export async function fromClient(
    client: Client,
    id: number,
    data: Buffer,
    header: Buffer
): Promise<void> {
    // Check if the client has a version.
    if (client.protocol == Protocol.UNKNOWN) {
        // Attempt to match the version.
        client.protocol = protocol.versions[id] ?? Protocol.UNKNOWN;
    } const version = client.protocol;

    // Get the identifiers for the packet.
    const name = protocol
        .bindings[version]
        .backwards[id] as string;
    if (name == undefined) throw new Error("Unknown packet ID.");

    const translatedId = protocol
        .bindings[Protocol.REL3_2]
        .forwards[name] as number;
    if (translatedId == undefined) throw new Error("Unknown packet name.");

    // Parse the data into a protocol buffer.
    const parsed = await utils.fromProto(data, name, version);
    if (parsed == undefined) throw new Error("Failed to parse packet.");

    // Invoke the modifier.
    await invokeModifier(parsed, client, name);

    // Translate the packet.
    const translated = await utils.toProto(parsed, name, Protocol.REL3_2);
    if (translated == undefined) throw new Error("Failed to translate packet.");

    // Send the packet to the server.
    const encoded = await utils.encodePacket(translated, translatedId,
        client.post ? client.encryptKey : keys.initial, header);
    if (encoded == undefined) throw new Error("Failed to encode packet.");
    // if (!logger.blacklist.includes(name)) {
        console.debug(`>> Translated packet ${name} (${id} -> ${translatedId})`);
    // }

    // Send the packet to the server.
    client.sendToServer(encoded);
}