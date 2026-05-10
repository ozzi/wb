// Version: 1
//"use strict";
var PID = function (Input, Setpoint, Kp, Ki, Kd, ControllerDirection, InitialOutput) {
    this.input = Input;
    this.mySetpoint = Setpoint;
    this.inAuto = false;
    this.setOutputLimits(0, 100);
    this.sampleTime = 1000;
    this.setTunings(Kp, Ki, Kd);
    this.setControllerDirection(ControllerDirection);
    this.lastTime = this.millis() - this.sampleTime;
    this.setIntegral(InitialOutput);
    this.setOutput(InitialOutput);
    this.tolerance = 0;
    this.enableLogging = false;
};

PID.prototype.setInput = function (NewInput) {
    this.input = NewInput;
};

PID.prototype.setPoint = function (SetPoint) {
    this.mySetpoint = SetPoint;
};

PID.prototype.setLogging = function (EnableLogging) {
    this.enableLogging = EnableLogging;
}

PID.prototype.millis = function () {
    var d = new Date();
    return d.getTime();
};

PID.prototype.setTunings = function (Kp, Ki, Kd) {
    if (Kp < 0 || Ki < 0 || Kd < 0) {
        return;
    }

    this.kp = Kp;
    this.ki = Ki;
    this.kd = Kd;
};

PID.prototype.setSampleTime = function (NewSampleTime) {
    if (NewSampleTime > 0) {
        this.sampleTime = NewSampleTime;
        this.lastTime = this.millis() - this.sampleTime;
    }
};

PID.prototype.setOutput = function (val) {
    if (val > this.outMax) {
        val = this.outMax;
    } else if (val < this.outMin) {
        val = this.outMin;
    }
    this.myOutput = val;
};

PID.prototype.setIntegral = function (val) {
    if (val > this.outMax) {
        val = this.outMax;
    } else if (val < this.outMin) {
        val = this.outMin;
    } else if (isNaN(val)) {
        val = (this.outMax + this.outMin) / 2;
    }
    this.integral = val;
};

PID.prototype.setOutputLimits = function (Min, Max) {
    if (Min >= Max) {
        return;
    }
    this.outMin = Min;
    this.outMax = Max;

    if (this.inAuto) {
        if (this.myOutput > this.outMax) {
            this.myOutput = this.outMax;
        } else if (this.myOutput < this.outMin) {
            this.myOutput = this.outMin;
        }

        this.setIntegral(this.integral);
    }
};

PID.prototype.setMode = function (Mode) {
    var newAuto;
    if (Mode.toString().toLowerCase() == 'automatic' || Mode.toString().toLowerCase() == 'auto') {
        newAuto = 1;
    } else if (Mode.toString().toLowerCase() == 'manual') {
        newAuto = 0;
    } else {
        throw new Error("Incorrect Mode Chosen");
    }

    if (newAuto == !this.inAuto) { //we just went from manual to auto
        this.initialize();
    }
    this.inAuto = newAuto;
};

PID.prototype.setControllerDirection = function (ControllerDirection) {
    if (ControllerDirection.toString().toLowerCase() == 'direct') {
        this.setDirection = 1;
    }
    else if (ControllerDirection.toString().toLowerCase() == 'reverse') {
        this.setDirection = -1;
    }
    else {
        throw new Error("Incorrect Controller Direction Chosen");
    }
};

PID.prototype.setTolerance = function (Tolerance) {
    this.tolerance = Tolerance;
}

PID.prototype.getOutMin = function () {
    return this.outMin;
};

PID.prototype.getOutMax = function () {
    return this.outMax;
};

PID.prototype.getKp = function () {
    return this.kp;
};

PID.prototype.getKd = function () {
    return this.kd;
};

PID.prototype.getKi = function () {
    return this.ki;
};

PID.prototype.getMode = function () {
    return this.inAuto ? "Auto" : "Manual";
};

PID.prototype.getDirection = function () {
    return this.controllerDirection;
};

PID.prototype.getOutput = function () {
    return this.myOutput;
};

PID.prototype.getInput = function () {
    return this.input;
};

PID.prototype.getSetPoint = function () {
    return this.mySetpoint;
};

PID.prototype.getIntegral = function () {
    return this.integral;
};

PID.prototype.initialize = function () {
    this.setIntegral(this.myOutput);
    this.previousError = 0;
    this.lastTime = this.millis() - this.sampleTime;
};

PID.prototype.compute = function () {
    if (!this.inAuto) {
        return false;
    }
    var now = this.millis();
    var timeChange = (now - this.lastTime);
    if (timeChange > 0) {
        var error = (this.mySetpoint - this.input) * this.setDirection;
        if (Math.abs(error) > this.tolerance) {
            var timeChangeInSec = timeChange / 1000;
            var output = this.update(error, timeChangeInSec);
            this.setOutput(output);
            this.lastTime = now;
            return true;
        } else {
            this.lastTime = now;
            return false;
        }
    } else {
        return false;
    }
};

PID.prototype.update = function (error, time) {
    var proportional = this.kp * error;
    var integral = this.integral + this.ki * time * (error + this.previousError) / 2;
    var derivative = this.kd / time * (error - this.previousError);
    var output = proportional + integral + derivative;
    this.setIntegral(integral);
    this.previousError = error;
    if (this.enableLogging) {
        log("pid E " + error + " ; P " + proportional + "; I " + this.integral + "; D " + derivative + "; O " + output);
    }
    return output;
}

module.exports = PID;

function makePIDController(
    deviceName,
    getValueClosure,
    outputTopicName,
    minOutput,
    maxOutput,
    direction,
    timeframe
) {
    var deviceName = "pid-controller-" + deviceName;
    defineVirtualDevice(deviceName, {
        title: "PID Controller: " + deviceName,
        cells: {
            enabled: {
                title: "Enabled",
                type: "switch",
                value: false,
                order: 1
            },
            set_point: {
                title: "Target value",
                type: "value",
                value: 35,
                readonly: false,
                order: 2
            },
            cp: {
                title: "Proportional gain",
                type: "range",
                value: 1,
                max: 100,
                min: 0,
                order: 3
            },
            ci: {
                title: "Integral gain / 10",
                type: "range",
                value: 1,
                max: 100,
                min: 0,
                order: 4
            },
            cd: {
                title: "Derivative gain",
                type: "range",
                value: 1,
                max: 100,
                min: 0,
                order: 5
            },
            tolerance: {
                title: "Tolerance",
                type: "value",
                value: 0,
                readonly: false,
                order: 6
            },
            logging: {
                title: "logging",
                type: "switch",
                value: false,
                order: 10
            },
            power: {
                title: "power",
                type: "value",
                value: 0,
                readonly: false,
                order: 20
            },
            integral: {
                title: "integral",
                type: "value",
                value: 0,
                readonly: true,
                order: 21
            }
        }
    });

    var enabledTopicName = deviceName + "/enabled";
    var setPointTopicName = deviceName + "/set_point";
    var cpTopicName = deviceName + "/cp";
    var ciTopicName = deviceName + "/ci";
    var cdTopicName = deviceName + "/cd";
    var integralTopicName = deviceName + "/integral";
    var powerTopicName = deviceName + "/power";
    var loggingTopicName = deviceName + "/logging";
    var toleranceTopicName = deviceName + "/tolerance";
    var length = maxOutput - minOutput;
    var normalizedPower = dev[outputTopicName] / length * 100;

    var ctr = new PID(
        getValueClosure(),
        dev[setPointTopicName],
        dev[cpTopicName],
        dev[ciTopicName] / 10,
        dev[cdTopicName],
        direction,
        normalizedPower
    );
    ctr.setSampleTime(timeframe);
    ctr.setMode("manual");

    var myControl = function () {
        var enabled = dev[enabledTopicName];
        if (enabled == true) {
            ctr.setMode("automatic");
        } else {
            ctr.setMode("manual");
        }
        var temperature = getValueClosure();
        var temperatureSetpoint = dev[setPointTopicName];
        var Kp = dev[cpTopicName];
        var Ki = dev[ciTopicName] / 10;
        var Kd = dev[cdTopicName];
        var tolerance = dev[toleranceTopicName];
        var enableLogging = dev[loggingTopicName];
        ctr.setLogging(enableLogging);
        ctr.setInput(temperature);
        ctr.setPoint(temperatureSetpoint);
        ctr.setTunings(Kp, Ki, Kd);
        ctr.setTolerance(tolerance);
        if (ctr.compute()) {
            dev[powerTopicName] = ctr.getOutput();
            dev[integralTopicName] = ctr.getIntegral();
        }
    };
    myControl();
    setInterval(myControl, timeframe);

    defineRule("pid-power-automation-" + deviceName, {
        whenChanged: [
          powerTopicName
        ],
        then: function (newValue) {
            var outLength = ctr.getOutMax() - ctr.getOutMin();
            var normalizedOutput = (maxOutput - minOutput) * newValue / outLength + minOutput;
            dev[outputTopicName] = normalizedOutput;
        }
      });
}

makePIDController(
    "dry-cooling",
    function () {
        return dev["wb-m1w2_225/External Sensor 2"];
    },
    "wb-mao4_100/Channel 1",
    0,
    10000,
    "reverse",
    900
);

makePIDController(
    "air-asic",
    function () {
        return dev["wb-m1w2_225/External Sensor 1"];//wb-m1w2_69/External Sensor 2
    },
    "wb-mao4_100/Channel 2",
    0,
    10000,
    "reverse",
    900
);

makePIDController(
    "esbe-actuator-asic",
    function () {
        return dev["wb-m1w2_33/External Sensor 1"];
    },
    "wb-mao4_100/Channel 3",
    0,
    10000,
    "reverse",
    900
);

makePIDController(
    "asic-pump",
    function () {
        return dev["wb-m1w2_33/External Sensor 2"] - dev["wb-m1w2_33/External Sensor 1"];
    },
    "pump-pwm-controller-asic/power",
    0,
    1000,
    "reverse",
    900
);

makePIDController(
    "dry-cooling-pump",
    function () {
        return dev["politech-water-flow-sensor-dry-cooling/flow_lm"]; //dev["wb-m1w2_225/External Sensor 1"] - dev["wb-m1w2_225/External Sensor 2"];
    },
    "pump-pwm-controller-dry-cooling-tower/power",
    0,
    1000,
    "direct",
    900
);

makePIDController(
    "pool-heat-exchanger-pump",
    function () {
        return dev["wb-m1w2_118/External Sensor 2"] - dev["wb-m1w2_118/External Sensor 1"];
    },
    "pump-pwm-controller-pool-heat-exchanger/power",
    0,
    1000,
    "reverse",
    900
);
