/**
 * https://github.com/wilberforce/pid-controller/tree/master
 * pid-controller -  A node advanced PID controller based on the Arduino PID library
 * github@wilberforce.co.nz Rhys Williams
 * Based on:
 * Arduino PID Library - Version 1.0.1
 * by Brett Beauregard <br3ttb@gmail.com> brettbeauregard.com
 * 
 * This Library is licensed under a GPL-3.0 License
 */

//"use strict";
var PID = function(Input, Setpoint, Kp, Ki, Kd, ControllerDirection, InitialOutput) {
    this.input = Input;
    this.mySetpoint = Setpoint;
    this.inAuto = false;
    this.setOutputLimits(0, 100);
    this.SampleTime = 1000;
    this.setTunings(Kp, Ki, Kd);
    this.setControllerDirection(ControllerDirection);
    this.lastTime = this.millis() - this.SampleTime;
    this.setIntegral(InitialOutput);
    this.setOutput(InitialOutput);
    this.enableLogging = true;
};

PID.prototype.setInput = function(current_value) {
    this.input = current_value;
};

PID.prototype.setPoint = function(current_value) {
    this.mySetpoint = current_value;
};

PID.prototype.millis = function() {
    var d = new Date();
    return d.getTime();
};

PID.prototype.compute = function() {
    if (!this.inAuto) {
        return false;
    }
    var now = this.millis();
    var timeChange = (now - this.lastTime);
    if (timeChange >= this.SampleTime) {
        var error = (this.mySetpoint - this.input) * this.setDirection;
        var output = this.update(error);
        this.setOutput(output);
        this.lastTime = now;
        return true;
    } else {
        return false;
    }
};

PID.prototype.update = function(error) {
    var proportional = this.kp * error;
    var integral = this.integral + this.ki * (error + this.previousError) / 2;
    var derivative = this.kd * (error - this.previousError);
    var output = proportional + integral + derivative;
    this.setIntegral(integral);
    this.previousError = error;
    if (this.enableLogging) {
      log("pid E " + error + "; P " + proportional + "; I " + this.integral + "; D " + derivative + "; O " + output);
    }
    return output;
}

PID.prototype.setTunings = function(Kp, Ki, Kd) {
    if (Kp < 0 || Ki < 0 || Kd < 0) {
        return;
    }

    this.dispKp = Kp;
    this.dispKi = Ki;
    this.dispKd = Kd;

    this.SampleTimeInSec = (this.SampleTime) / 1000;
    this.kp = Kp;
    this.ki = Ki * this.SampleTimeInSec;
    this.kd = Kd / this.SampleTimeInSec;
};

PID.prototype.setSampleTime = function(NewSampleTime) {
    if (NewSampleTime > 0) {
        var ratio = NewSampleTime / (1.0 * this.SampleTime);
        this.ki *= ratio;
        this.kd /= ratio;
        this.SampleTime = Math.round(NewSampleTime);
    }
};

PID.prototype.setOutput = function(val) {
    if (val > this.outMax) {
        val = this.outMax;
    } else if (val < this.outMin) {
        val = this.outMin;
    }
    this.myOutput = val;
};

PID.prototype.setIntegral = function(val) {
    if (val > this.outMax) {
        val = this.outMax;
    } else if (val < this.outMin) {
        val = this.outMin;
    }
    this.integral = val;
};

PID.prototype.setLogging = function(val) {
    this.enableLogging = val;
}

PID.prototype.setOutputLimits = function(Min, Max) {
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

PID.prototype.setMode = function(Mode) {
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

PID.prototype.initialize = function() {
    this.setIntegral(this.myOutput);
    this.previousError = 0;
};

PID.prototype.setControllerDirection = function(ControllerDirection) {
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

PID.prototype.getNormalizedOutput = function(normalizedMin, normalizedMax) {
    var output = this.getOutput();
    var outLength = this.outMax - this.outMin;
    var normalizedOutput = (normalizedMax - normalizedMin) * output / outLength  + normalizedMin;
    return normalizedOutput;
}

PID.prototype.getKp = function() {
    return this.dispKp;
};

PID.prototype.getKd = function() {
    return this.dispKd;
};

PID.prototype.getKi = function() {
    return this.dispKi;
};

PID.prototype.getMode = function() {
    return this.inAuto ? "Auto" : "Manual";
};

PID.prototype.getDirection = function() {
    return this.controllerDirection;
};

PID.prototype.getOutput = function() {
    return this.myOutput;
};

PID.prototype.getInput = function() {
    return this.input;
};

PID.prototype.getSetPoint = function() {
    return this.mySetpoint;
};

PID.prototype.getIntegral = function() {
    return this.integral;
};

module.exports = PID;

function makePIDController(
  deviceName,
  getValueClosure,
  outputTopicName,
  direction,
  timeframe
) {
  var deviceName = "pid-controller-" + deviceName;
    defineVirtualDevice(deviceName, {
      title: "Dry Cooling PID Controller",
      cells: {
        enabled: {
            title: "Enabled",
            type: "switch",
            value: false,
            order: 1
        },
        set_point: {
            title: "Target value",
            type: "range",
            value: 35,
            max: 60,
            min: 15,
            order: 2
        },
        cp: {
            title: "Proportional coef",
            type: "range",
            value: 1,
            max: 100,
            min: 0,
            order: 3
        },
        ci: {
            title: "Integral coef / 10",
            type: "range",
            value: 1,
            max: 100,
            min: 0,
            order: 4
        },
        cd: {
            title: "Derivative coef",
            type: "range",
            value: 1,
            max: 100,
            min: 0,
            order: 5
        },
        min_output: {
            title: "min output",
            type: "range",
            value: 0,
            max: 10000,
            min: 0,
            order: 6
        },
        max_output: {
            title: "max output",
            type: "range",
            value: 10000,
            max: 10000,
            min: 0,
            order: 7
        },
        integral: {
            title: "integral",
            type: "value",
            value: 0,
            read_only: true,
            order: 8
        }
      }
    });

  var enabledTopicName = deviceName + "/enabled";
  var setPointTopicName = deviceName + "/set_point";
  var cpTopicName = deviceName + "/cp";
  var ciTopicName = deviceName + "/ci";
  var cdTopicName = deviceName + "/cd";
  var minOutputTopicName = deviceName + "/min_output";
  var maxOutputTopicName = deviceName + "/max_output";
  var integralTopicName = deviceName + "/integral";
  var length = dev[maxOutputTopicName] - dev[minOutputTopicName];
  var normalizedPower = dev[outputTopicName] / length * 100;
  
  var ctr = new PID(
    getValueClosure(),
    dev[setPointTopicName],
    dev[cpTopicName],
    dev[ciTopicName],
    dev[cdTopicName],
    direction,
    normalizedPower
  );
  ctr.setSampleTime(timeframe);
  ctr.setMode("manual");
  
  var myControl = function() {
    var enabled = dev[enabledTopicName];
    if (enabled == true) {
      ctr.setMode("automatic");
    } else {
      ctr.setMode("manual");
    }
	var temperature = getValueClosure(); 
  	var temperatureSetpoint =  dev[setPointTopicName]; 
    var Kp = dev[cpTopicName];
    var Ki = dev[ciTopicName] / 10;
    var Kd = dev[cdTopicName];
    var minOutput = dev[minOutputTopicName];
    var maxOutput = dev[maxOutputTopicName];
    
  	ctr.setInput(temperature);
  	ctr.setPoint(temperatureSetpoint);
  	ctr.setTunings(Kp, Ki, Kd);
  	if (ctr.compute()) {
        dev[outputTopicName] = ctr.getNormalizedOutput(minOutput, maxOutput);
        dev[integralTopicName] = ctr.getIntegral();
    }
  };
  myControl();
  setInterval(myControl, timeframe);
}

//makePIDController("asic-esbe-actuator", "wb-m1w2_33/External Sensor 1", "wb-mao4_213/Channel 1", "direct", 2000);
makePIDController(
    "dry-cooling",
    function() {
        return dev["wb-m1w2_225/External Sensor 2"];
    },
    "wb-mao4_213/Channel 2",
    "reverse",
    1000
);