import { getWeb3Polygon } from "@orbs-network/pos-analytics-lib";
const polygonEndpoint = 'https://polygon-mainnet.g.alchemy.com/v2/c93z5UqYd5bR2paVR7PtUXhkVEIDIex0';

let web3Singleton;

export async function setSingleWeb3() {
    web3Singleton = await getWeb3Polygon(polygonEndpoint);
}

export function getWeb3() {
    return web3Singleton;
}


