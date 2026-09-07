// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice A receiving address whose only destination is its immutable treasury.
/// No administrator, upgrade, external initializer, fee deduction or delegatecall.
contract InvoiceForwarder is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address payable public immutable treasury;
    event Forwarded(address indexed token, address indexed treasury, uint256 amount);

    constructor(address payable destination) {
        require(destination != address(0), "Zero treasury");
        treasury = destination;
    }

    /// Anyone can pay gas. A caller cannot choose the destination or retain funds.
    function sweep(address token) external nonReentrant returns (uint256 amount) {
        amount = IERC20(token).balanceOf(address(this));
        if (amount == 0) return 0;
        IERC20(token).safeTransfer(treasury, amount);
        emit Forwarded(token, treasury, amount);
    }

    function sweepNative() external nonReentrant {
        uint256 amount = address(this).balance;
        if (amount == 0) return;
        (bool ok,) = treasury.call{value: amount}("");
        require(ok, "Native transfer failed");
        emit Forwarded(address(0), treasury, amount);
    }

    receive() external payable {}
}

/// @notice Invoice salts and destinations determine addresses; callers do not.
contract InvoiceForwarderFactory {
    event Created(address indexed forwarder, address indexed treasury, bytes32 indexed salt);

    function predict(address treasury, bytes32 salt) public view returns (address) {
        bytes32 codeHash = keccak256(abi.encodePacked(type(InvoiceForwarder).creationCode, abi.encode(treasury)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, codeHash)))));
    }

    function deploy(address payable treasury, bytes32 salt) public returns (InvoiceForwarder forwarder) {
        require(treasury != address(0), "Zero treasury");
        address predicted = predict(treasury, salt);
        if (predicted.code.length != 0) return InvoiceForwarder(payable(predicted));
        forwarder = new InvoiceForwarder{salt: salt}(treasury);
        emit Created(address(forwarder), treasury, salt);
    }

    /// Safe to call repeatedly: later calls only forward newly arrived balances.
    function deployAndSweep(address payable treasury, bytes32 salt, address token) external {
        deploy(treasury, salt).sweep(token);
    }
}
