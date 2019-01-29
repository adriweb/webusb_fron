import { ServiceId } from "./ServiceId.js";

export class RawPacket
{
    SourceAddress: number;
    DestinationAddress: number;
    SourceServiceId: ServiceId;
    DestinationServiceId: ServiceId;
    ACK: number;
    Sequence: number = 0;
    Data: Uint8Array;

    constructor(sourceAddress: number, sourceServiceId: ServiceId, destinationAddress: number, destinationServiceId: ServiceId, ACK: number, Data: Uint8Array)
    {
        this.SourceAddress = sourceAddress;
        this.DestinationAddress = destinationAddress;
        this.SourceServiceId = sourceServiceId;
        this.DestinationServiceId = destinationServiceId;
        this.ACK = ACK;
        this.Data = Data;
    }

    static fromHeaderAndData(header: Uint8Array, data: Uint8Array): RawPacket
    {
        let rp = new this(
            ((header[2] << 8) | header[3]),
            ((header[4] << 8) | header[5]),
            ((header[6] << 8) | header[7]),
            ((header[8] << 8) | header[9]),
            header[13],
            data);
        rp.Sequence = header[14];

        return rp;
    }

    public GetRawData(sequenceId: number) : Uint8Array
    {
        const HEADER_SIZE = 16;

        let ret = new Uint8Array(HEADER_SIZE + this.Data.length);
        ret[0]  = 0x54;
        ret[1]  = 0xFD;
        ret[2]  = ((this.SourceAddress >> 8) & 0xFF);
        ret[3]  = (this.SourceAddress & 0xFF);
        ret[4]  = ((this.SourceServiceId >> 8) & 0xFF);
        ret[5]  = (this.SourceServiceId & 0xFF);
        ret[6]  = ((this.DestinationAddress >> 8) & 0xFF);
        ret[7]  = (this.DestinationAddress & 0xFF);
        ret[8]  = ((this.DestinationServiceId >> 8) & 0xFF);
        ret[9]  = (this.DestinationServiceId & 0xFF);
        ret[12] = this.Data.length;
        ret[13] = this.ACK;
        ret[14] = sequenceId;

        // Calculate checksums
        const checksum = this._GetDataChecksum();
        ret[10] = ((checksum >> 8) & 0xFF);
        ret[11] = (checksum & 0xFF);
        for (let i = 0; i < HEADER_SIZE - 1; i++)
        {
            ret[15] += ret[i];
        }

        // Fill in data
        for (let i = 0; i < this.Data.length; i++)
        {
            ret[HEADER_SIZE + i] = this.Data[i];
        }

        return ret;
    }

    private _GetDataChecksum() : number
    {
        let ret = 0x0000;

        for (let i=0; i<this.Data.length; i++)
        {
            const b = this.Data[i];
            const first = ((b << 8) | (ret >> 8));
            ret = (ret & 0xFF);
            const second = ((((ret & 0x0F) << 4) ^ ret) << 8);
            const third = (second >> 5);
            ret = (third >> 7);
            ret = ((ret ^ first ^ second ^ third) & 0xFFFF);
        }

        return ret;
    }
}