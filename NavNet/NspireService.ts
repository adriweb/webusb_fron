import { RawPacket } from "./RawPacket.js";
import { ServiceId } from "./ServiceId.js";

const _sourceAddress = 0x6400;
const _destinationAddress = 0x6401;

// @ts-ignore
const { createWriteStream } = window.streamSaver;

export class NspireService
{
    // @ts-ignore
    private _queue: Queue<number> = new Queue<number>();
    private _incompletePacket: number[] = [];
    private _incompletePacketData: number[] = [];

    private _nextSequenceId: number = 0;

    private _OSSize: number = 0;
    private _receivedFirstPacket: boolean = false;

    private _device: any;
    private _os_fileStream : any = null;
    private _os_writer : any = null;

    constructor(device: any)
    {
        this._device = device;
    }

    public async handleInData(buffer: Uint8Array)
    {
        console.log("buffer.length = " + buffer.length);
        buffer.forEach && buffer.forEach((element) => { this._queue.enqueue(element); });
        await this._TryConstructPacket();
    }

    private async _HandlePacket(packet: RawPacket)
    {
        let handled = false;

        //Deal with packets where ACK byte takes priority
        if (packet.ACK == 0x0A) {
            handled = true;
        }

        //Deal with packets where source service ID takes priority
        if (!handled)
        {
            switch (packet.SourceServiceId)
            {
                case ServiceId.ServiceDisconnection:
                {
                    console.info('case ServiceId.ServiceDisconnection');
                    //Acknowledge the request
                    await this._SendData(new RawPacket(_sourceAddress, packet.Sequence == 0 ? 0x00FE : 0x00FF, _destinationAddress,
                        ((packet.Data[0] << 8) | packet.Data[1]), 0x0A,
                        Uint8Array.of((packet.DestinationServiceId >> 8) & 0xFF, packet.DestinationServiceId & 0xFF)),
                        packet.Sequence);

                    handled = true;
                    break;
                }
                default:
                    console.info('case unknown: packet.SourceServiceId = ' + packet.SourceServiceId);
                    break;
            }
        }

        //Deal with packets where destination service ID takes priority
        if (!handled)
        {
            switch (packet.DestinationServiceId)
            {
                case ServiceId.InstallOS:
                {
                    console.info('case ServiceId.InstallOS');
                    //Acknowledge the request
                    await this._SendData(new RawPacket(_sourceAddress, packet.Sequence == 0 ? 0x00FE : 0x00FF, _destinationAddress,
                        packet.SourceServiceId, 0x0A,
                        Uint8Array.of((packet.DestinationServiceId >> 8) & 0xFF, packet.DestinationServiceId & 0xFF)),
                        packet.Sequence);

                    //Determine what request this is
                    let requestType = 0;
                    if (packet.Data != null && packet.Data.length > 1) {
                        requestType = packet.Data[0];
                    } else {
                        throw new Error("InstallOS: Invalid request type");
                    }

                    switch (requestType)
                    {
                        case 0x03:
                        {
                            console.info('      InstallOS -> request type 3 (installOS)');
                            //This is the start of the OS install, fetch the size bytes
                            if (packet.Data.length < 5) {
                                throw new Error("InstallOS: Invalid initial request size");
                            }

                            this._OSSize = ((packet.Data[1] << 24) & 0xFF000000) | ((packet.Data[2] << 16) & 0x00FF0000) |
                                           ((packet.Data[3] << 8) & 0x0000FFFF) | (packet.Data[4] & 0xFF);
                            console.info('      InstallOS -> _OSSize = ' + this._OSSize);

                            this._receivedFirstPacket = false;

                            this._os_fileStream = createWriteStream('os.tcc');
                            console.info('      InstallOS -> _os_fileStream created');

                            //Let the other device know we're ready to start receiving the OS data
                            await this._SendData(new RawPacket(_sourceAddress, ServiceId.InstallOS, _destinationAddress, packet.SourceServiceId, 0x00,
                                Uint8Array.of(0x04)), ++this._nextSequenceId);

                            handled = true;
                            break;
                        }
                        case 0x05:
                        {
                            //This is OS data, receive and write it
                            if(!this._os_fileStream) throw new Error('_os_fileStream null, wut?');
                            if(!this._os_writer) { this._os_writer = this._os_fileStream.getWriter(); console.info('      InstallOS -> request type 5 (OS data packet). _os_writer created');}
                            this._os_writer.write(packet.Data.subarray(1));

                            this._OSSize -= (packet.Data.length - 1);

                            if (!this._receivedFirstPacket)
                            {
                                await this._SendData(new RawPacket(_sourceAddress, ServiceId.InstallOS, _destinationAddress, packet.SourceServiceId, 0x00,
                                    Uint8Array.of(0xFF, 0x00)), ++this._nextSequenceId);
                                this._receivedFirstPacket = true;
                            }

                            if (this._OSSize <= 0 || packet.Data.length < 0xFE)
                            {
                                //We're done receiving the OS, so let the other calculator know we're done (100%)
                                this._os_writer.close();
                                await this._SendData(new RawPacket(_sourceAddress, ServiceId.InstallOS, _destinationAddress, ServiceId.InstallOS, 0x00,
                                    Uint8Array.of(0x06, 0x64)), ++this._nextSequenceId);
                            }

                            handled = true;
                            break;
                        }
                        default:
                            console.info('      InstallOS -> request type unknown: ' + requestType);
                            break;
                    }

                    handled = true;
                    break;
                }
                case ServiceId.DeviceAddressAssignment:
                {
                    console.info('case ServiceId.DeviceAddressAssignment');
                    await this._SendData(new RawPacket(_sourceAddress, ServiceId.DeviceAddressAssignment,
                        _destinationAddress, ServiceId.DeviceAddressAssignment, 0x00,
                        Uint8Array.of(((_destinationAddress >> 8) & 0xFF), (_destinationAddress & 0xFF), 0xFF, 0x00)), ++this._nextSequenceId);
                    handled = true;
                    break;
                }
                case ServiceId.Login:
                {
                    console.info('case ServiceId.Login');
                    await this._SendData(new RawPacket(_sourceAddress, ServiceId.NACK, _destinationAddress, packet.SourceServiceId, 0x0A,
                        Uint8Array.of((ServiceId.Login >> 8) & 0xFF, ServiceId.Login & 0xFF)), packet.Sequence);
                    handled = true;
                    break;
                }
                case ServiceId.DeviceInformation:
                {
                    console.info('case ServiceId.DeviceInformation');
                    //Acknowledge the request
                    await this._SendData(new RawPacket(_sourceAddress, packet.Sequence == 0 ? 0x00FE : 0x00FF, _destinationAddress, packet.SourceServiceId, 0x0A,
                        Uint8Array.of((packet.DestinationServiceId >> 8) & 0xFF, packet.DestinationServiceId & 0xFF)), packet.Sequence);

                    //Determine the type of request this is
                    let requestType = 0;
                    if (packet.Data != null && packet.Data.length >= 1) {
                        requestType = packet.Data[0];
                    } else {
                        throw new Error("DeviceInformation request: invalid packet type");
                    }

                    switch (requestType)
                    {
                        case 0x01: //return general device information
                        {
                            console.info('      DeviceInformation -> request type 1 (general device information)');
                            const data = Uint8Array.of(0x01, 0x00, 0x00, 0x00, 0x00, 0x06, 0x62, 0xC8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07, 0x34, 0x00,
                                0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xA7, 0x9F, 0x74, 0x00, 0x00, 0x00, 0x00, 0x03, 0x39, 0x61,
                                0xC0, 0xFF, 0x01, 0x00, 0x84, 0x03, 0x02, 0x07, 0x01, 0x03, 0x00, 0x00, 0x63, 0x03, 0x02, 0x00,
                                0x8D, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x01, 0x40, 0x00, 0xF0, 0x10,
                                0x01, 0x1F, 0x38, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x31, 0x30, 0x35, 0x32, 0x31, 0x46, 0x33,
                                0x43, 0x30, 0x00, 0x31, 0x30, 0x30, 0x38, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x31, 0x30, 0x35,
                                0x32, 0x31, 0x46, 0x33, 0x43, 0x30, 0x36, 0x34, 0x34, 0x45, 0x30, 0x33, 0x30, 0x43, 0x00);
                            await this._SendData(new RawPacket(_sourceAddress, ServiceId.DeviceInformation, _destinationAddress, packet.SourceServiceId, 0x00, data), ++this._nextSequenceId);
                            break;
                        }
                        case 0x02: //return device name
                        {
                            console.info('      DeviceInformation -> request type 2 (device name - UNIMPLEMENTED)');
                            break;
                        }
                        case 0x03: //return list of supported file extensions
                        {
                            console.info('      DeviceInformation -> request type 2 (list of supported file extensions - UNIMPLEMENTED)');
                            break;
                        }
                        default:
                            console.info('      DeviceInformation -> request type ' + requestType + ' (unknown?? - UNIMPLEMENTED)');
                            break;
                    }

                    handled = true;
                    break;
                }
                default:
                    console.info('case unknown: packet.DestinationServiceId = ' + packet.DestinationServiceId);
                    break;
            }
        }

        // return handled;
    }

    private async _SendData(packet: RawPacket, sequenceId: number)
    {
        //Send it!
        await this._device.transferOut(packet.GetRawData(sequenceId));
    }

    private async _TryConstructPacket()
    {
        const PACKET_HEADER_SIZE = 16;

        //Get the raw packet header
        while (this._incompletePacket.length < PACKET_HEADER_SIZE)
        {
            let count = this._queue.size();
            if (count == 0) {
                break;
            }

            this._incompletePacket.push(<number>this._queue.dequeue());
        }

        if (this._incompletePacket.length == PACKET_HEADER_SIZE)
        {
            //We have a valid packet header

            //Get the data
            const size = <number>this._incompletePacket[12];
            while (this._incompletePacketData.length < size)
            {
                const count = this._queue.size();
                if (count == 0) {
                    break;
                }

                this._incompletePacketData.push(<number>this._queue.dequeue());
            }

            if (this._incompletePacketData.length >= size)
            {
                //We have a whole packet!
                const packet = RawPacket.fromHeaderAndData(new Uint8Array(this._incompletePacket), new Uint8Array(this._incompletePacketData));

                //Now reset everything
                this._incompletePacket = [];
                this._incompletePacketData = [];

                await this._HandlePacket(packet);
            }
        }
    }
}
