import * as fs from "node:fs";
import { readPacketIds } from "@app/utils";
import { Protocol } from "@app/types";

/**
 * Fetches an environment variable or returns a fallback value.
 * @param name The name of the environment variable.
 * @param fallback The fallback value to return if the environment variable is not set.
 */
function $(name: string, fallback: string = ""): string {
    return process.env[name] ?? fallback;
}

/**
 * Fetches an environment variable and converts it to a boolean.
 * @param name The name of the environment variable.
 * @param fallback The fallback value to return if the environment variable is not set.
 */
function $b(name: string, fallback: boolean = false): boolean {
    return process.env[name] == "true" ?? fallback;
}

/**
 * Fetches an environment variable and converts it to a number.
 * @param name The name of the environment variable.
 * @param fallback The fallback value to return if the environment variable is not set.
 */
function $n(name: string, fallback: number = 0): number {
    const value = parseInt(process.env[name]);
    return isNaN(value) ? fallback : value;
}

export const logger = {
    level: $("LOG_LEVEL", "debug"),
    debug: $b("LOG_DEBUG", false),

    blacklist: ["PingReq", "PingRsp"]
};

export const network = {
    port: $n("PORT", 22102),
    server: {
        address: $("SERVER_ADDRESS", "127.0.0.1"),
        port: $n("SERVER_PORT", 22101)
    },
    two: {
        forwards: readPacketIds(fs.readFileSync("resources/protos/two/cmdid.csv").toString(), false),
        backwards: readPacketIds(fs.readFileSync("resources/protos/two/cmdid.csv").toString(), true)
    },
    three: {
        forwards: readPacketIds(fs.readFileSync("resources/protos/three/cmdid.csv").toString(), false),
        backwards: readPacketIds(fs.readFileSync("resources/protos/three/cmdid.csv").toString(), true)
    }
};

export const protocol = {
    /* Bindings for GetPlayerTokenReq -> Version */
    versions: {
        172: Protocol.REL3_2,
        179: Protocol.REL3_3
    },
    /* Bindings for Protocol -> Packet IDs */
    bindings: {
        [Protocol.REL3_2]: network.two,
        [Protocol.REL3_3]: network.three,
    },
    /* Bindings for Protocol -> Definitions Root */
    root: {
        [Protocol.REL3_2]: "resources/protos/two",
        [Protocol.REL3_3]: "resources/protos/three"
    }
};

export const keys = {
    initial: Buffer.from(fs.readFileSync("resources/keys/initial.b64").toString(), "base64"),
    post_gc: fs.readFileSync("resources/keys/post-gc.bin")
};

export const account = {
    override: $b("ACCOUNT_OVERRIDE", false),
    accountId: $("ACCOUNT_ID", "1"),
    accountToken: $("ACCOUNT_TOKEN", "1"),
}