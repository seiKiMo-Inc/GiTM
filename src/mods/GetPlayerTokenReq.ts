import { Client } from "@app/types";
import { account } from "@app/constants";

type GetPlayerTokenReq = {
    platformType: number;
    accountUid: string;
    accountType: number;
    subChannelId: number;
    channelId: number;
    accountToken: string;
    clientRandKey: string;
    keyId: 5;
    lang: 1;
};

/**
 * Packet modification handler for 'GetPlayerTokenReq'.
 * @param object The packet object. Before translation.
 * @param client The client instance sending the packet.
 */
export default async function(
    object: GetPlayerTokenReq,
    client: Client
): Promise<void> {
    // Check for an account override.
    if (!account.override) return;

    // Modify the packet.
    object.accountUid = account.accountId;
    object.accountToken = account.accountToken;
}