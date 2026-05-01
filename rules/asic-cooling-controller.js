function makeASICPoolHeatController(
    name,
    poolHeatRequestTopicName,
    asicDeviceNames
) {
    defineRule("asic-pool-heat-" + name, {
        whenChanged: [poolHeatRequestTopicName],
        then: function () {
            var heatRequest = dev[poolHeatRequestTopicName];
            log("[asic-pool-heat-{}] heat_request = {}", name, heatRequest);
            for (var i = 0; i < asicDeviceNames.length; i++) {
                var asicDevice = asicDeviceNames[i];
                if (heatRequest) {
                    dev[asicDevice + "/selected_preset"] = "optimal";
                } else {
                    dev[asicDevice + "/selected_preset"] = "0";
                }
            }
        }
    });
}

makeASICPoolHeatController(
    "outdoor",
    "pool-heat-ctrl-outdoor/heat_request",
    ["ANTMINER T21-1", "ANTMINER T21-2"]
);
