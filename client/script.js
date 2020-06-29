if(URLh && (URLh[URLh.length-1] !== "/" || URLh[URLh.length-1] !== "\\"))
    URLh+="/"

function newID() {
    return Math.random().toString(36).substr(2, 9)+"_"+Math.random().toString(36).substr(2, 9);
};
function POST(URL, data, callback){
    var req = new XMLHttpRequest()
    req.open('POST', URL, true)
    req.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    req.timeout = 10000
    req.onreadystatechange = function (evt) {
        if (req.readyState == 4) {
            if(req.status == 200)
                callback(req.responseText)
        }
    };
    req.ontimeout = function (e) {
        callback(null, e)
    };
    req.send(data); 
}

class GoRTC extends EventTarget{
    constructor(urls, STUNconfig){
        super()
        this.url = {host: URLh+"host", connect: URLh+"connect"}
        if(urls && urls.host) this.url.host = urls.host 
        if(urls && urls.connect) this.url.connect = urls.connect 
        this.configuration = {'iceServers': [{'urls': 'stun:stun.l.google.com:19302'}]}
        if(STUNconfig) this.configuration = STUNconfig
        this.PCs = {} //list of connections
    }
    
    //user-available methods
    host(opts){
        return new Host(this, opts)
    }
    connect(id, opts){
        return new Connection(this, id, opts)
    }
}


class Connection extends EventTarget{ 
    #opts = {}//some default opts
    constructor(rtc, id, opts){ //TODO opts?
        super()
        this.rtc = rtc
        this.id = id    //id of connection(same as host id if connected to host)
        for(var o in opts)
            this.#opts[o] = opts[o]

        if(this.#opts.cId) this.cId = this.#opts.cId    //hostDerived connection sets this to host id
        else this.cId = newID()

        if(!this.#opts.hostDerived)
            this.#connect()
            
    }
    #handleChannel = (ch)=>{
        this.channels[ch.label] = ch
        switch(ch.label){
            case "message":
                ch.onopen = (e)=>{
                    if(ch.pending) {
                        for(var P of ch.pending)    ch.send(P)
                        ch.pending = []
                    }
                }
                ch.onclose = (e)=>{}
                ch.onmessage = (e)=>{
                    var data = JSON.parse(e.data)
                    this.dispatchEvent(new CustomEvent("message", {detail:{id: this.id, label: data.label, data: data.data}}))
                }
                break
            case "system":
                ch.onopen = ()=>{};ch.onclose = ()=>{}
                ch.onmessage = (e)=>{
                    if(e.data === "close"){
                        this.peerCon.close()
                        this.dispatchEvent(new CustomEvent("closed", {detail:{desc:"forced remotely", id: this.id}}))
                    }
                }
                break
            case "stream":
                ch.onopen = (e)=>{};ch.onclose = (e)=>{}
                ch.onmessage = (e)=>{
                    this.dispatchEvent(new CustomEvent("stream", {detail:{id: this.id, label:e.data.label, data:e.data.data}}))
                }
                break
            case "file":
                ch.onopen = (e)=>{};ch.onclose = (e)=>{}
                ch.onmessage = (e)=>{
                    this.dispatchEvent(new CustomEvent("file", {detail:{id: this.id,label:e.data.label, data:e.data.data}})) //TODO save file partially
                    //TODO GORTC.addeventlistener("filepart", (e)=>{})       e.label, e.data, e.progress, totalsize, speed
                    //TODO GORTC.addeventlistener("file", (e)=>{})           e.label, e.type, e.data
                }
                break
        }
    }
    createChannels(){   //it's not private due to Host object is calling this method
        var messageCh = this.peerCon.createDataChannel("message")
        this.#handleChannel(messageCh)
        var systemCh = this.peerCon.createDataChannel("system")
        this.#handleChannel(systemCh)
        var streamCh = this.peerCon.createDataChannel("stream");
        this.#handleChannel(streamCh)
        var fileCh = this.peerCon.createDataChannel("file");
        this.#handleChannel(fileCh)
    }
    hookEvents(){   //it's not private due to Host object is calling this method
        this.peerCon.onconnectionstatechange = event => {
            switch(this.peerCon.connectionState){
                case 'connected':
                    this.dispatchEvent(new CustomEvent("connected", {detail:{id:this.id}}))
                    break
                case 'disconnected':
                    this.dispatchEvent(new CustomEvent("disconnected", {detail:{id:this.id}}))
                    break
                case 'failed':
                    this.dispatchEvent(new CustomEvent("failed", {detail:{id:this.id}}))
                    break
                case 'closed':
                    this.dispatchEvent(new CustomEvent("closed", {detail:{id:this.id}}))
                    break
            }
        };
        this.peerCon.ondatachannel = event => {
            this.#handleChannel(event.channel, this.id)
        }
    }
    #connect = async ()=>{
        this.channels = {}
        this.peerCon = new RTCPeerConnection(this.rtc.configuration)
        this.createChannels()

        const offer = await this.peerCon.createOffer()
        await this.peerCon.setLocalDescription(offer)
        
        var noAnswer = false
        POST(this.rtc.url.connect, JSON.stringify({id: this.id, offer:offer, cId: this.cId}) , async (data, error)=>{    //sending offer and setting answer from response
            if(error){  //TODO some retry function and autoretry option
                noAnswer = true
                this.dispatchEvent(new CustomEvent("failed", {detail:{id:this.id, desc:"problem while contacting with server"}}))
                return
            }
            data = JSON.parse(data)
            if(data.paused || !data.answer){  //TODO some retry function and autoretry option
                noAnswer = true
                this.dispatchEvent(new CustomEvent("failed", {detail:{id:this.id, desc: "host is paused"}}))
                return
            }
            const remoteDesc = new RTCSessionDescription(data.answer)
            await this.peerCon.setRemoteDescription(remoteDesc)
        })

        const INST = this
        async function listen(){//here we're listenning for iceCandidates from host
            POST(INST.rtc.url.connect, JSON.stringify({id: INST.id, iceListener: true, cId: INST.cId}) , async (candidate, err)=>{
                if(candidate === "0" || noAnswer || 
                    ["connected", "failed", "disconnected", "closed"].includes(INST.peerCon.connectionState)){
                    return //end of listening("0" means host with that id no longer exists)
                }
                listen() //its async so we can call it anywhere inside
                if(err) return
                candidate = JSON.parse(candidate)
                try {
                    await INST.peerCon.addIceCandidate(candidate);
                } catch (e) {
                    console.error('Error adding received ice candidate', e);
                }
            })
        }
        listen()
    
        this.hookEvents()
        this.peerCon.onicecandidate = event => {
            if (event.candidate)    //we're sending candidate to host
                POST(this.rtc.url.connect, JSON.stringify({id: this.id, iceCandidate: event.candidate, cId: this.cId}), ()=>{});
        };
    }
        //User methods starts here
    message(label, data){
        if(this.peerCon.connectionState === "closed") return false
        if(this.channels["message"].readyState === "open")
            this.channels["message"].send(JSON.stringify({label:label, data:data}))
        else{
            if(!this.channels["message"].pending)
                this.channels["message"].pending = []
            this.channels["message"].pending.push(JSON.stringify({label:label, data:data}))
        }
        return true
    }
    close(){
        if(this.peerCon.connectionState !== "closed"){
            if(this.channels["system"].readyState === "open")
                this.channels["system"].send("close")
            this.peerCon.close()
            this.dispatchEvent(new CustomEvent("closed", {detail: {desc: "forced close", id: this.id}}))
        }
    }
}

class Host extends EventTarget{ 
    constructor(rtc, opts){ //TODO opts?
        super()
        this.rtc = rtc
        this.#host()
    }
    #host = async (ID)=>{
        const INST = this
        this.cons = {}
        async function listen(){ //we're listening for offers and candidates
            POST(INST.rtc.url.host,JSON.stringify({listener: true, id: ID}), async (data,err)=>{
                if(data === "0"){   //this means we lost our id, caused by inactivity
                    INST.#host()  //restarting for new one
                    return
                }
                listen() //async, call it wherever

                if(err || INST.closed) return  //error or no data(timed out), so nothing to parse
    
                if(INST.paused && !!data){
                    POST(INST.rtc.url.host, JSON.stringify({id: ID, paused: true}), ()=>{})
                    return
                }
                data = JSON.parse(data)
                for(var cId in data){
                    if(!INST.cons[cId]){
                        INST.cons[cId] = new Connection(INST.rtc, cId, {hostDerived: true, cId: ID})
                
                        INST.cons[cId].channels = {}
                        INST.cons[cId].peerCon = new RTCPeerConnection(INST.rtc.configuration)
                        INST.cons[cId].createChannels()
                        INST.cons[cId].hookEvents()
                        INST.cons[cId].candidates = []
                        INST.cons[cId].peerCon.onicecandidate = event => {
                            if (event.candidate)    //we're sending candidate to host
                                POST(INST.rtc.url.host, JSON.stringify({id: ID, iceCandidate: event.candidate, cId: cId}), ()=>{});
                        };
                        INST.cons[cId].addEventListener("closed", ()=> delete INST.cons[cId])
                        INST.cons[cId].addEventListener("failed", ()=> delete INST.cons[cId])
                        INST.dispatchEvent(new CustomEvent("connecting", {detail: {id: cId, connection: INST.cons[cId]}}))
                    }
                    if(!!data[cId].offer){
                        INST.cons[cId].peerCon.setRemoteDescription(new RTCSessionDescription(data[cId].offer))
                        const answer = await INST.cons[cId].peerCon.createAnswer()
                        await INST.cons[cId].peerCon.setLocalDescription(answer) //sending answer
                        POST(INST.rtc.url.host, JSON.stringify({id: ID, answer: answer, cId: cId}), ()=>{})
                        for(var cand of INST.cons[cId].candidates){
                            try {   //adding candidates from before
                                await INST.cons[cId].peerCon.addIceCandidate(cand);
                            } catch (e) {
                                console.error('Error adding received ice candidate', e);
                            }
                        }
                        INST.cons[cId].candidates = []
                    }
                    if(!!data[cId].iceCandidate){
                        if(!INST.cons[cId].peerCon.remoteDescription)    //we have to set offer first
                        INST.cons[cId].candidates.push(data[cId].iceCandidate)  //i'm taking this one later
                        else{
                            try {   //received candidate, adding
                                await INST.cons[cId].peerCon.addIceCandidate(data[cId].iceCandidate);
                            } catch (e) {
                                console.error('Error adding received ice candidate', e);
                            }
                        }
                    }
                }
            })
        }
        if(!ID){//gathering new host id
            POST(this.rtc.url.host, JSON.stringify({getId: true}), (id, err)=>{
                if(err) {
                    this.dispatchEvent(new CustomEvent("hosterror", {detail:{error: err}}))
                    return
                }
                this.id = ID = id
                this.dispatchEvent(new CustomEvent("hostidreceived", {detail:{id: ID}}))
                listen()
            })
        }else{
            listen()
        }
    }

    //user available methods
    pause(){    //pauses host, declines incoming connections, but saves class and ID
        this.paused = true
    }
    resume(){   //resumes paused host, accepts again incoming connections
        this.paused = false
    }
    stop(){     //deletes host from server, closes all connections, object will be destroyed/unusable
        this.closed = true

    }
}