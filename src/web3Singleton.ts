import { getWeb3Polygon } from "@orbs-network/pos-analytics-lib";
import dotenv from 'dotenv';
import * as process from "process";

dotenv.config();
const polygonEndpoint = process.env.PROVIDER_ENDPOINT;

let web3Singleton;

export async function setSingleWeb3() {
    web3Singleton = await getWeb3Polygon(polygonEndpoint);
}

export function getWeb3() {
    return web3Singleton;
}
