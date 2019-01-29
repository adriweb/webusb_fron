const deviceCardTemplate = $("#deviceCardTemplate");
const devicesContainer   = $("#devicesContainer");
const thinsp = "<span class='thinsp'></span>";

const webusb = {};

function hexStrToArrayBuffer(hexStr)
{
    return new Uint8Array(hexStr.match(/([\da-f]{2})\s*/gi).map((h) => parseInt(h, 16)));
}

function buf2hex(buffer)
{
    // buffer is an ArrayBuffer
    return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('').toUpperCase();
}

function chunk_buffer(data)
{
    // todo
}

function findOrCreateDevice(rawDevice)
{
    return webusb.getDevice(rawDevice) || (new webusb.Device(rawDevice));
}

(function ()
{
    'use strict';
    webusb.devices = {};

    const makeDeviceIdentStr = (rawDevice) => {
        return `${rawDevice.manufacturerName}|${rawDevice.productName}|${rawDevice.serialNumber}`;
    };

    webusb.getDevices = function ()
    {
        return navigator.usb.getDevices().then(devices =>
        {
            return devices.map(device => {
                console.log("webusb.getDevices | device chosen: ", device);
                return findOrCreateDevice(device);
            });
        });
    };

    webusb.requestDevice = function ()
    {
        const filters = [
            //{ vendorId: 0x0451, productId: 0xE001 }, // Silverlink
            //{ vendorId: 0x0451, productId: 0xE003 }, // 84+
            //{ vendorId: 0x0451, productId: 0xE004 }, // 89T...
            //{ vendorId: 0x0451, productId: 0xE008 }, // 84+ SE/CSE/CE...
            { vendorId: 0x0451 /*, productId: 0xE012 */ }, // Nspire (all models)
        ];
        return navigator.usb.requestDevice({filters: filters}).then(device =>
        {
            console.log("webusb.requestDevice", device);
            return findOrCreateDevice(device);
        });
    };

    webusb.Device = function (device)
    {
        this.device_ = device;
        this.identStr = makeDeviceIdentStr(device);
        webusb.devices[this.identStr] = this;

        this.logDeviceStrings();
        this.createDeviceGUIIfNeeded();

        // todo here: get device info/capabilities... ?
    };

    webusb.deleteDevice = function (device)
    {
        delete webusb.devices[device.identStr];
    };

    webusb.getDevice = function (device)
    {
        return webusb.devices[makeDeviceIdentStr(device)];
    };


    webusb.Device.prototype.logDeviceStrings = function()
    {
        console.log(this.identStr);
        console.log(this);
    };

    webusb.Device.prototype.createDeviceGUIIfNeeded = function()
    {
        const device = this;

        const newDiv = deviceCardTemplate.clone();
        newDiv.removeAttr('id');

        const autoClearLog = newDiv.find("input.autoClearLog");

        newDiv.find(".deviceActionButtons > button").each( (idx, btn) => {
            const $btn = $(btn);
            $btn.on('click', () => { autoClearLog.is(":checked") && device.gui.log.empty(); } );
            switch ($btn.data('action'))
            {
                case 'receiveOS':
                    $btn.on('click', () => { device.receiveOS() });
                    break;
            }
        });

        this.gui = {
            root: newDiv,
            name: newDiv.find("h4.card-header"),
            details: newDiv.find("p.deviceDetails"),
            log: newDiv.find("div.deviceLog"),
            state: newDiv.find("span.deviceState"),
            lastActivity: newDiv.find("span.deviceLastActivity")
        };

        this.gui.name.text(this.device_.productName);

        newDiv.find("button.clearLog").on('click', () => { device.gui.log.empty() });

        devicesContainer.append(newDiv);
    };

    webusb.Device.prototype.connect = async function ()
    {
        await this.device_.open();
        await this.device_.selectConfiguration(1);

        const iface = this.device_.configuration.interfaces[0];
        await this.device_.claimInterface(iface.interfaceNumber);

        const epOut = iface.alternate.endpoints.filter((ep) => ep.direction === "out")[0];
        const epIn  = iface.alternate.endpoints.filter((ep) => ep.direction === "in")[0];

        this.config = {
            interface: iface,
            outEPnum: epOut.endpointNumber,
            inEPnum : epIn.endpointNumber,
            outPacketSize: epOut.packetSize,
            inPacketSize : epIn.packetSize
        };
    };

    webusb.Device.prototype.disconnect = function ()
    {
        return this.device_.close();
    };

    webusb.Device.prototype.transferOut = function (data)
    {
        console.debug(`transferOut\t| data = ${data}`);
        let str = ""+buf2hex(data);
        str = str.substr(0, 8) + thinsp + str.substr(8, 2) + thinsp + str.substr(10);
        this.gui.log[0].innerHTML += `<span class='out'>${moment().format('HH:mm:ss.SSS')} &gt; ${str}</span></br>`;
        /************************/
        return this.device_.transferOut(this.config.outEPnum, data);
    };

    webusb.Device.prototype.transferInWithLen = function(length)
    {
        console.debug(`transferInWithLen\t| length = ${length}`);
        return this.device_.transferIn(this.config.inEPnum, length);
    };

    webusb.Device.prototype.transferIn = function ()
    {
        return this.transferInWithLen(this.config.inPacketSize);
    };

    webusb.Device.prototype.responseHandler = function(result)
    {
        let str = ""+buf2hex(result.data.buffer);
        str = str.substr(0, 8) + thinsp + str.substr(8, 2) + thinsp + str.substr(10);
        this.gui.log[0].innerHTML += `<span class='in'>${moment().format('HH:mm:ss.SSS')} &lt; ${str}</span></br>`;
    };

    webusb.Device.prototype.receiveOS = function ()
    {
        this.connect().then(async () =>
        {
            // TODO here
        })
        .then(() => this.disconnect());
    };

})();


function handleConnectEvent(event)
{
    const rawDevice = event.device;
    console.log('connect event', rawDevice);
    findOrCreateDevice(rawDevice);
}

function cleanUpDevice(device)
{
    webusb.deleteDevice(device);
}

function disconnectDevice(rawDevice)
{
    const device = webusb.getDevice(rawDevice);
    if (device)
    {  // This can fail if the I/O code already threw an exception
        device.gui.root.remove();
        device.disconnect()
            .then(s =>
            {
                console.log("disconnected", device);
                cleanUpDevice(device);
            }, e =>
            {
                console.log("nothing to disconnect", device);
                cleanUpDevice(device);
            });
    }
}

function handleDisconnectEvent(event)
{
    console.log('disconnect event', event.device);
    disconnectDevice(event.device);
}

function registerEventListeners()
{
    navigator.usb.addEventListener('connect', handleConnectEvent);
    navigator.usb.addEventListener('disconnect', handleDisconnectEvent);
}

function requestConnection(event)
{
    webusb.requestDevice();
    event.preventDefault();
}

$(function(){
    registerEventListeners();
    $("#grantConnect").on("click", requestConnection);
    webusb.getDevices();
});