var meterName = "outdoor";
var meter = makePoolFiltrationMeter(meterName, "wb-mr6cu_91/K1", 5000);

var scheduleName = "outdoor";
var sched = makePoolFiltrationSchedule(
    scheduleName,
    meter.poolVolumeTopicName,
    meter.pumpFlowRateTopicName,
    meter.filterDiameterTopicName
);

makePoolFiltrationController(
    "outdoor",
    "wb-mr6cu_91/K1",
    sched.scheduleTopicName,
    sched.scheduleModeTopicName,
    "wb-mcm8_238/Input 3"
);
