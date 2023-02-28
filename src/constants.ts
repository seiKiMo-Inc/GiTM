import * as fs from "node:fs";
import { readPacketIds } from "@app/utils";

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
    level: $("LOG_LEVEL", "info"),
    debug: $b("LOG_DEBUG", false)
};

export const network = {
    port: $n("PORT", 22102),
    two: readPacketIds(fs.readFileSync("resources/protos/two/cmdid.csv").toString(), false),
    three: readPacketIds(fs.readFileSync("resources/protos/three/cmdid.csv").toString(), true),
};

export const keys = {
    initial: Buffer.from(fs.readFileSync("resources/keys/initial.b64").toString(), "base64"),
    post: Buffer.from(fs.readFileSync("resources/keys/post.b64").toString(), "base64")
};