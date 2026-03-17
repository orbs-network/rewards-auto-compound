import {getDelegators, getGuardians} from "@orbs-network/pos-analytics-lib";
import {getWeb3, setSingleWeb3} from './web3Singleton'
import {stakingRewardsAbi} from './abi'
import {constants} from "./constants";
import * as process from "process";
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import {bigToNumber} from "@orbs-network/pos-analytics-lib/dist/helpers";
import BigNumber from 'bignumber.js';
const EthereumMulticall = require('@orbs-network/ethereum-multicall');
const MULTICALL3_POLYGON_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

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
        const g_info = await getDelegators(guardian.address, getWeb3());
        stakers.push(guardian.address);
        for (const d of g_info) {
            if (d.stake > constants.compoundRewardsThreshold) stakers.push(d.address);
        }
    }
    console.log(`Found ${stakers.length} stakers`)
    return stakers;
}

function isSimulationMode() {
    return process.argv.includes('--simulate') || process.env.SIMULATE === 'true';
}

function getSimulationResults(simulationResponse) {
    return simulationResponse.returnData || simulationResponse[2] || [];
}

async function claimBatch(stakersList: string[], simulate: boolean) {
    console.log(simulate ? 'Simulating...' : 'Claiming...');
    let numberOfWallets = 0;
    let totalCompounded = 0;
    const web3 = getWeb3();
    const account = web3.eth.accounts.privateKeyToAccount(process.env.PK);
    web3.eth.accounts.wallet.add(account);
    const senderAddress = account.address;
    const multicall = new EthereumMulticall.Multicall({web3Instance: web3});
    const multicallContract = new web3.eth.Contract(EthereumMulticall.Multicall.ABI, MULTICALL3_POLYGON_ADDRESS);
    const stakingRewardContract = new web3.eth.Contract(stakingRewardsAbi, constants.stakingRewardContractAddress);
    const stakersListLen = stakersList.length;
    let calls;

    const chunksNum = Math.ceil((constants.baseGas+constants.additionalWallet*stakersListLen) / (constants.blockGasLimit*constants.blockUtilization));
    const chunkSize = Math.max(1, Math.floor(stakersListLen/chunksNum))
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
                reference: `claim-${staker}`,
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
        if (simulate) {
            const encodedCalls = calls.map((call) => ({
                target: constants.stakingRewardContractAddress,
                callData: stakingRewardContract.methods.claimStakingRewards(call.methodParameters[0]).encodeABI()
            }));
            const simulation = await multicallContract.methods
                .tryBlockAndAggregate(false, encodedCalls)
                .call({from: senderAddress});
            const simulationResults = getSimulationResults(simulation);
            const failedCalls = calls
                .map((call, index) => ({call, result: simulationResults[index]}))
                .filter((entry) => !entry.result || !entry.result.success)
                .map((entry) => entry.call.methodParameters[0]);

            console.log(`Chunk ${Math.floor(i / chunkSize) + 1}: eth_call ok=${calls.length - failedCalls.length}/${calls.length}`);
            if (failedCalls.length > 0) {
                console.log(`Failed stakers: ${failedCalls.join(', ')}`);
            }

            try {
                const estimatedGas = await multicallContract.methods
                    .aggregate(encodedCalls)
                    .estimateGas({from: senderAddress});
                console.log(`Chunk ${Math.floor(i / chunkSize) + 1}: estimated gas ${estimatedGas}`);
            } catch (e) {
                console.log(`Chunk ${Math.floor(i / chunkSize) + 1}: estimateGas failed: ${e.message}`);
            }
            continue;
        }

        await multicall.send(contractCallContext, {
            from: senderAddress,
            gas: constants.blockGasLimit * constants.blockUtilization,
            maxPriorityFeePerGas: constants.maxPriorityFeePerGas,
            maxFeePerGas: constants.maxFeePerGas
        })
    }
    console.log(`${simulate ? 'Simulated' : 'Successfully claimed for'} ${numberOfWallets}/${stakersListLen} accounts`)
    return {numberOfWallets, totalCompounded};
}

async function main() {
    dotenv.config();
    await setSingleWeb3()
    const simulate = isSimulationMode();
    if (simulate) console.log("Simulation mode enabled")
    const stakers = await getDelegatorsList();
    const {numberOfWallets, totalCompounded} = await claimBatch(stakers, simulate)
    if (simulate) {
        console.log(`Simulation mode enabled, skipped metrics post. Wallets=${numberOfWallets}, totalCompounded=${totalCompounded}`);
        return;
    }
    await CalcAndSendMetrics(numberOfWallets, totalCompounded)
}
main().then(() => console.log("Done!")).catch(console.error)
