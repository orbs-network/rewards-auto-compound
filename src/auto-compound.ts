import {getGuardian, getGuardians} from "@orbs-network/pos-analytics-lib";
import {getWeb3, setSingleWeb3} from './web3Singleton'
import {stakingRewardsAbi} from './abi'
import {constants} from "./constants";
import * as process from "process";
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import {bigToNumber} from "@orbs-network/pos-analytics-lib/dist/helpers";
import BigNumber from 'bignumber.js';


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
        console.log(`Working on guardian ${guardian}`)
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
    const stakingRewardContract = new web3.eth.Contract(stakingRewardsAbi, constants.stakingRewardContractAddress);
    const gas = constants.gasLimit;
    for (const staker of stakersList) {
        try {
            const rewardBalance = await stakingRewardContract.methods.getDelegatorStakingRewardsData(staker).call();
            let balance = bigToNumber(new BigNumber(rewardBalance.balance));
            const receipt = await stakingRewardContract.methods.claimStakingRewards(staker).send({from: process.env.ADDRESS, gas, maxPriorityFeePerGas: constants.maxPriorityFeePerGas, maxFeePerGas: constants.maxFeePerGas});
            numberOfWallets += 1;
            totalCompounded += balance;
            // console.log(receipt.transactionHash);
            console.log(staker);
        } catch (e) {
            console.error(`Error while claiming for ${staker}: ${e}`);
        }
    }
    console.log(`Successfully claimed for ${numberOfWallets}/${stakersList.length} accounts`)
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
