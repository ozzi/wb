// Version: 1

function getWaterDensity(tempC) {
    var t = tempC;
    var density_kg_m3 = 999.85308 + 6.32693e-2 * t - 8.523829e-3 * Math.pow(t, 2) +
        6.943248e-5 * Math.pow(t, 3) - 3.821216e-7 * Math.pow(t, 4);
    return density_kg_m3 / 1000;
}

function makeFlowSensor(
    name,
    inletTemperatureTopicName,
    outletTemperatureTopicName,
    heaterPowerTopicName
) {
    var deviceName = "calculated-flow-sensor-" + name;
    defineVirtualDevice(deviceName, {
        title: "Virtual Flow Sensor - " + name,
        cells: {
            flow_rate: {
                type: "value",
                unit: "l/min",
                readonly: true,
                value: 0
            },
            heat_capacity: {
                type: "value",
                unit: "J/(kg·K)",
                value: 4184,
                readonly: false,
            },
            efficiency: {
                type: "value",
                unit: "%",
                readonly: false,
                value: 1
            },
            activated: {
                title: "Activated",
                type: "switch",
                value: true
            }
        }
    });

    var flowRateTopicName = deviceName + "/flow_rate";
    var heatCapacityTopicName = deviceName + "/heat_capacity";
    var efficiencyTopicName = deviceName + "/efficiency";
    var activatedTopicName = deviceName + "/activated";

    defineRule("calculate_flow_rate_" + name, {
        whenChanged: [
            heaterPowerTopicName,
            inletTemperatureTopicName,
            outletTemperatureTopicName,
            heatCapacityTopicName,
            efficiencyTopicName,
            activatedTopicName
        ],
        then: function () {
            var power = dev[heaterPowerTopicName];
            var tempIn = dev[inletTemperatureTopicName];
            var tempOut = dev[outletTemperatureTopicName];
            var activated = dev[activatedTopicName];
            if (activated == true && power > 0 && tempIn < tempOut) {
                var heatCapacity = dev[heatCapacityTopicName];
                var efficiency = dev[efficiencyTopicName];

                var avgTemp = (tempIn + tempOut) / 2;
                var density = getWaterDensity(avgTemp);
                var massFlow = power * efficiency / (heatCapacity * (tempOut - tempIn));
                var flowRate = (massFlow / density) * 60;
                dev[flowRateTopicName] = flowRate;
            } else {
                dev[flowRateTopicName] = 0;
            }
        }
    });
}

makeFlowSensor("ASIC", "wb-m1w2_33/External Sensor 1", "wb-m1w2_33/External Sensor 2", "ASIC-sensor-TOTAL/power");
//makeFlowSensor("DRY COOLER", "wb-m1w2_225/External Sensor 2", "wb-m1w2_225/External Sensor 1", "ASIC-sensor-TOTAL/power");
makeFlowSensor("POOL HE", "wb-m1w2_118/External Sensor 1", "wb-m1w2_118/External Sensor 2", "ASIC-sensor-TOTAL/power");
makeFlowSensor("POOL FILTR", "wb-m1w2_69/External Sensor 1", "wb-m1w2_69/External Sensor 2", "ASIC-sensor-TOTAL/power");
