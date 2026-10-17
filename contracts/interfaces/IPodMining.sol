// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPodMining {
    struct Miner {
        address circuits;
        uint64 circuitId;
        uint32 taskId;
        uint32 gateCount;
        uint32 stateCount;
        uint32 depth;
        uint64 area;
        uint32 mult;
        uint64 since;
        uint8 status;
        address registrant;
        uint32 nandBurn;
        uint32 latchBurn;
        uint64 bstar;
        uint64 bonus;
        bool optimal;
        uint64 commitBlock;
        uint64 firstUnusedId;
        uint64 stopBlock;
        uint128 verifWeight;
        uint128 unverWeight;
        uint256 debt;
    }
    function getMiner(bytes32 key) external view returns (Miner memory);
    function claim(bytes32 key) external;
    function claimMany(bytes32[] calldata keys) external;
    function pending(bytes32 key) external view returns (uint256);
    function paused() external view returns (bool);
    function token() external view returns (address);
    function maxRunGas() external view returns (uint256);
    function passesCounterexamples(address circuits, uint256 id, uint32 taskId, uint32 gateCount, uint256 budget) external view returns (bool);
}
