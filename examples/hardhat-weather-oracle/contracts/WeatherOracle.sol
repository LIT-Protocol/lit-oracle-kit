// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract WeatherOracle {
    struct WeatherData {
        int temperature;
        uint8 precipitationProbability;
        uint256 lastUpdated;
    }

    WeatherData public currentWeather;
    address public oracle;

    event WeatherUpdated(int temperature, uint8 precipitationProbability, uint256 timestamp);

    constructor(address _oracle) {
        oracle = _oracle;
    }

    modifier onlyOracle() {
        require(msg.sender == oracle, "Only oracle can update weather");
        _;
    }

    function updateWeather(int _temperature, uint8 _precipitationProbability) external { //onlyOracle {
        currentWeather = WeatherData({
            temperature: _temperature,
            precipitationProbability: _precipitationProbability,
            lastUpdated: block.timestamp
        });

        emit WeatherUpdated(_temperature, _precipitationProbability, block.timestamp);
    }

    function setOracle(address _newOracle) external onlyOracle {
        oracle = _newOracle;
    }
} 