import {getGuardian, getGuardians} from "@orbs-network/pos-analytics-lib";
import {getWeb3, setSingleWeb3} from './web3Singleton'
import {stakingRewardsAbi} from './abi'
import {constants} from "./constants";
import * as process from "process";
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import {bigToNumber} from "@orbs-network/pos-analytics-lib/dist/helpers";
import BigNumber from 'bignumber.js';
const EthereumMulticall = require('@orbs-network/ethereum-multicall');

async function CalcAndSendMetrics(numberOfWallets, totalCompounded) {
    const web3 = getWeb3();
    // get staking balance
    const minABI = [{"constant":true, "inputs":[{"name":"_owner","type":"address"}], "name":"balanceOf", "outputs":[{"name":"balance","type":"uint256"}], "type":"function"}, {"constant":true, "inputs":[], "name":"decimals", "outputs":[{"name":"","type":"uint8"}], "type":"function"}];
    const tokenContract = new web3.eth.Contract(minABI, constants.orbsErc20)
    let stakingBalance = await tokenContract.methods.balanceOf(constants.stakingContract).call();
    stakingBalance = bigToNumber(new BigNumber(stakingBalance));

    const json = {"numberOfWallets": numberOfWallets, "totalCompounded": totalCompounded, "stakingBalance": stakingBalance}
    const response = await fetch(constants.esEndpoint, {
        method: 'post',
        body: JSON.stringify(json),
        headers: {'Content-Type': 'application/json'}
    });
}

async function getDelegatorsList() {
    console.log("Getting a list of stakers...")
    let stakers: string[] = [];
    const allGuardians = await getGuardians(constants.nodeEndpoints)
    for (const guardian of allGuardians) {
        console.log(`Working on guardian ${guardian.address}`)
        const g_info = await getGuardian(guardian.address, getWeb3());
        stakers.push(g_info.address);
        for (const d of g_info.delegators) {
            if (d.stake > constants.compoundRewardsThreshold) stakers.push(d.address);
        }
    }
    console.log(`Found ${stakers.length} stakers`)
    return stakers;
}

async function claimBatch(stakersList: string[]) {
    console.log('Claiming...');
    let numberOfWallets = 0;
    let totalCompounded = 0;
    const web3 = getWeb3();
    const account = web3.eth.accounts.privateKeyToAccount(process.env.PK);
    web3.eth.accounts.wallet.add(account);
    const multicall = new EthereumMulticall.Multicall({web3Instance: web3});
    const stakingRewardContract = new web3.eth.Contract(stakingRewardsAbi, constants.stakingRewardContractAddress);
    const stakersListLen = stakersList.length;
    let calls;

    const chunksNum = Math.ceil((constants.baseGas+constants.additionalWallet*stakersListLen) / (constants.blockGasLimit*constants.blockUtilization));
    const chunkSize = Math.floor(stakersListLen/chunksNum)
    console.log(`Running in ${chunksNum} chunks of ${chunkSize}`);
    for (let i = 0; i < stakersList.length; i += chunkSize) {
        calls = [];
        const chunk = stakersList.slice(i, i + chunkSize);
        while (chunk.length) {
            const staker = chunk.shift();
            console.log(staker);
            const rewardBalance = await stakingRewardContract.methods.getDelegatorStakingRewardsData(staker).call();
            let balance = bigToNumber(new BigNumber(rewardBalance.balance));
            numberOfWallets += 1;
            totalCompounded += balance;

            calls.push({
                reference: 'autoCompound',
                methodName: 'claimStakingRewards',
                methodParameters: [staker]
            })
        }
        const contractCallContext = [{
            reference: 'autoCompound',
            contractAddress: constants.stakingRewardContractAddress,
            abi: stakingRewardsAbi,
            calls
        }];
        await multicall.send(contractCallContext, {
                from: process.env.ADDRESS,
                gas: constants.blockGasLimit * constants.blockUtilization,
                maxPriorityFeePerGas: constants.maxPriorityFeePerGas,
                maxFeePerGas: constants.maxFeePerGas
            })
    }
    console.log(`Successfully claimed for ${numberOfWallets}/${stakersListLen} accounts`)
    return {numberOfWallets, totalCompounded};
}

async function main() {
    dotenv.config();
    await setSingleWeb3()
    const stakers = await getDelegatorsList();
    const {numberOfWallets, totalCompounded} = await claimBatch(stakers)
    await CalcAndSendMetrics(numberOfWallets, totalCompounded)
}
main().then(() => console.log("Done!")).catch(console.error)
