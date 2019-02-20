import { NspireService } from "./NavNet/NspireService.js";

const deviceCardTemplate = $("#deviceCardTemplate");
const devicesContainer   = $("#devicesContainer");
const thinsp = "<span class='thinsp'></span>";

const delay = ms => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

let _myInterval;
const clearMyInterval = function()
{
    try {
        if (typeof(_myInterval) !== 'undefined') {
            clearInterval(_myInterval);
            _myInterval = undefined;
        }
    } catch (e) { }
};

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

function uint8_to_hex(buffer)
{
    return Array.prototype.map.call(buffer, x => ('00' + x.toString(16)).slice(-2)).join('').toUpperCase();
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
            //{ vendorId: 0x0451, productId: 0xE012 }, // Nspire (all models)
            { vendorId: 0x0451 }, // all TI
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

        this.connect();
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
                    $btn.on('click', () => { device.receiveOS(); $btn[0].disabled = true; });
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

        this.ready = true;

        this.ns = new NspireService(this);
        let readLoop = async () => {
            const data = await this.transferIn();
            const u8buf = await this.osRecvHandler(data);
            //await delay(20);
            await this.ns.handleInData(u8buf);
            if (this.ready) {
                await readLoop();
            }
        };
        _myInterval = setInterval(this.ns.logRemainingOSFile.bind(this.ns), 2000);
        await readLoop();
    };

    webusb.Device.prototype.disconnect = function ()
    {
        clearMyInterval();
        this.ready = false;
        return this.device_.close();
    };

    webusb.Device.prototype.transferOut = function (data)
    {
        //const strorig = ""+buf2hex(data);
        //const str = strorig.substr(0, 8) + thinsp + strorig.substr(8, 2) + thinsp + strorig.substr(10);
        //this.gui.log[0].innerHTML += `<span class='out'>${moment().format('HH:mm:ss.SSS')} &gt; ${str}</span></br>`;
        //console.debug(`transferOut\t| data = ${strorig}`);

        /************************/
        return this.device_.transferOut(this.config.outEPnum, data);
    };

    webusb.Device.prototype.transferInWithLen = function(length)
    {
        //console.debug(`transferInWithLen\t| length = ${length}`);
        return this.device_.transferIn(this.config.inEPnum, length);
    };

    webusb.Device.prototype.transferIn = function ()
    {
        return this.transferInWithLen(this.config.inPacketSize);
    };

    webusb.Device.prototype.responseHandler = function(result)
    {
        //const u8buf = new Uint8Array(result.data.buffer);
        //const strorig = ""+uint8_to_hex(u8buf);
        //const str = strorig.substr(0, 8) + thinsp + strorig.substr(8, 2) + thinsp + strorig.substr(10);
        //this.gui.log[0].innerHTML += `<span class='in'>${moment().format('HH:mm:ss.SSS')} &lt; ${str}</span></br>`;
        //console.debug(`transferIn\t| data = ${strorig}`);
    };

    webusb.Device.prototype.writeOSSizeLeft = function(sizeLeft) {
        this.gui.log[0].innerHTML += `<span class='in'>${moment().format('HH:mm:ss.SSS')} os size left: ${sizeLeft}</span></br>`;
    };

    webusb.Device.prototype.osRecvHandler = function(result) {

        const u8buf = new Uint8Array(result.data.buffer);
        //const strorig = ""+uint8_to_hex(u8buf);
        //const str = strorig.substr(0, 8) + thinsp + strorig.substr(8, 2) + thinsp + strorig.substr(10);
        //this.gui.log[0].innerHTML += `<span class='in'>${moment().format('HH:mm:ss.SSS')} &lt; ${str}</span></br>`;
        //console.debug(`transferIn\t| data = ${strorig}`);

        return u8buf;
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
                try { device.ns && device.ns.closeOSFile(); clearMyInterval(); } catch (e) { }
                cleanUpDevice(device);
            }, e =>
            {
                console.log("nothing to disconnect", device);
                try { device.ns && device.ns.closeOSFile(); clearMyInterval(); } catch (e) { }
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
