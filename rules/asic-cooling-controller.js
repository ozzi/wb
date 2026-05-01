function makeASICPoolHeatController(
    name,
    poolHeatRequestTopicName,
    asicDeviceNames
) {
    function applyHeatRequest() {
        var heatRequest = dev[poolHeatRequestTopicName];
        log("[asic-pool-heat-{}] heat_request = {}", name, heatRequest);
        for (var i = 0; i < asicDeviceNames.length; i++) {
            var asicDevice = asicDeviceNames[i];
            if (heatRequest) {
                dev[asicDevice + "/start_mining"] = true;
            } else {
                dev[asicDevice + "/stop_mining"] = true;
            }
        }
    }

    defineRule("asic-pool-heat-" + name, {
        whenChanged: [poolHeatRequestTopicName],
        then: function () {
            applyHeatRequest();
        }
    });

    applyHeatRequest();
}

makeASICPoolHeatController(
    "outdoor",
    "pool-heat-ctrl-outdoor/heat_request",
    ["ANTMINER S21e"]
);
