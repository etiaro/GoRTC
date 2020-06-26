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
    handleChannel(ch, id){
        this.PCs[id].channels[ch.label] = ch
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
                    this.dispatchEvent(new CustomEvent("message", {detail:{id: id,label: data.label, data: data.data}}))
                }
                break
            case "system":
                ch.onopen = ()=>{};ch.onclose = ()=>{}
                ch.onmessage = (e)=>{
                    if(e.data === "close"){
                        this.dispatchEvent(new CustomEvent("closed", {detail:{desc:"forced remotely", id: id}}))
                        this.PCs[id].peerCon.close()
                        delete this.PCs[id]
                    }
                }
                break
            case "stream":
                ch.onopen = (e)=>{};ch.onclose = (e)=>{}
                ch.onmessage = (e)=>{
                    this.dispatchEvent(new CustomEvent("stream", {detail:{id: id,label:e.data.label, data:e.data.data}}))
                }
                break
            case "file":
                ch.onopen = (e)=>{};ch.onclose = (e)=>{}
                ch.onmessage = (e)=>{
                    this.dispatchEvent(new CustomEvent("file", {detail:{id: id,label:e.data.label, data:e.data.data}})) //TODO save file partially
                    //GORTC.addeventlistener("filepart", (e)=>{})       e.label, e.data, e.progress, totalsize, speed
                    //GORTC.addeventlistener("file", (e)=>{})           e.label, e.type, e.data
                }
                break
        }
    }
    createChannels(id){
        var messageCh = this.PCs[id].peerCon.createDataChannel("message")
        this.handleChannel(messageCh, id)
        var systemCh = this.PCs[id].peerCon.createDataChannel("system")
        this.handleChannel(systemCh, id)
        var streamCh = this.PCs[id].peerCon.createDataChannel("stream");
        this.handleChannel(streamCh, id)
        var fileCh = this.PCs[id].peerCon.createDataChannel("file");
        this.handleChannel(fileCh, id)
    }
    host(ID){
        const cId = newID()
        
        this.PCs[cId] = {id: cId, channels: {}}
        this.PCs[cId].peerCon = new RTCPeerConnection(this.configuration)
        this.createChannels(cId)
        
        const INST = this
        var candidates = []
        async function listen(){ //we're listening for offers and candidates
            POST(INST.url.host,JSON.stringify({listener: true, id: ID}), async (data,err)=>{
                if(!INST.PCs[cId] || ["connected", "failed", "disconnected", "closed"].includes(INST.PCs[cId].peerCon.connectionState)) { //end of connecting 
                    return//it's no longer needed, next one will be called
                }
                if(data === "0"){   //this means we lost our id
                    INST.host()  //restarting for new one
                    delete INST.PCs[cId]
                    return
                }
                listen() //async, call it wherever
                if(err) return
    
                data = JSON.parse(data)
                if(!!data.offer){
                    INST.PCs[cId].peerCon.setRemoteDescription(new RTCSessionDescription(data.offer))
                    const answer = await INST.PCs[cId].peerCon.createAnswer()
                    await INST.PCs[cId].peerCon.setLocalDescription(answer) //sending answer
                    POST(INST.url.host, JSON.stringify({id: ID, answer: answer}), ()=>{})
                    for(var cand of candidates){
                        try {   //adding candidates from before
                            await INST.PCs[cId].peerCon.addIceCandidate(cand);
                        } catch (e) {
                            console.error('Error adding received ice candidate', e);
                        }
                    }
                    candidates = []
                }
                if(!!data.iceCandidate){
                    if(!INST.PCs[cId].peerCon.remoteDescription)    //we have to set offer first
                        candidates.push(data.iceCandidate)  //i'm taking this one later
                    else{
                        try {   //received candidate, adding
                            await INST.PCs[cId].peerCon.addIceCandidate(data.iceCandidate);
                        } catch (e) {
                            console.error('Error adding received ice candidate', e);
                        }
                    }
                }
            })
        }
        if(!ID){//gathering new host id
            POST(this.url.host, JSON.stringify({getId: true}), (id, err)=>{
                if(err) {
                    this.dispatchEvent(new CustomEvent("hosterror", {detail:{error: err}}))
                    return
                }
                ID = id
                this.dispatchEvent(new CustomEvent("hoststarted", {detail:{id: ID}}))
                listen()
            })
        }else{
            listen()
        }
        
        var wasConnected = false
        this.PCs[cId].peerCon.onconnectionstatechange = event => {
            switch(this.PCs[cId].peerCon.connectionState){
                case 'connected':
                    wasConnected = true
                    this.host(ID) 
                    this.dispatchEvent(new CustomEvent("connected", {detail:{id:cId}}))
                    break
                case 'disconnected':
                    this.dispatchEvent(new CustomEvent("disconnected", {detail:{id:cId}}))
                    break
                case 'failed':
                    if(!wasConnected)   this.host(ID)
                    this.dispatchEvent(new CustomEvent("failed", {detail:{id:cId}}))
                    delete this.PCs[cId]
                    break
                case 'closed':
                    this.dispatchEvent(new CustomEvent("closed", {detail:{id:cId}}))
                    delete this.PCs[cId]
                    break
            }
        };
        this.PCs[cId].peerCon.onicecandidate = event => {
            if (event.candidate)    //sending ice candidate
                POST(this.url.host, JSON.stringify({id: ID, iceCandidate: event.candidate}), ()=>{});
        };
        this.PCs[cId].peerCon.ondatachannel = function(event) {
            INST.handleChannel(event.channel, cId)
        }
    }
    async connect(id){
        this.PCs[id] = {id: id, channels: {}}
        this.PCs[id].peerCon = new RTCPeerConnection(this.configuration)
        this.createChannels(id)

        const offer = await this.PCs[id].peerCon.createOffer()
        await this.PCs[id].peerCon.setLocalDescription(offer)
        
        var noAnswer = false
        POST(this.url.connect, JSON.stringify({id: id, offer:offer}) , async (data, error)=>{    //sending offer and setting answer from response
            if(error){
                noAnswer = true
                delete this.PCs[id]
                this.dispatchEvent(new CustomEvent("failed", {detail:{id:id}}))
                return
            }
            data = JSON.parse(data)
            const remoteDesc = new RTCSessionDescription(data.answer)
            await this.PCs[id].peerCon.setRemoteDescription(remoteDesc)
        })

        const INST = this
        async function listen(){//here we're listenning for iceCandidates from host
            POST(INST.url.connect, JSON.stringify({id: id, iceListener: true}) , async (candidate, err)=>{
                if(candidate === "0" || noAnswer || !INST.PCs[id] || 
                    ["connected", "failed", "disconnected", "closed"].includes(INST.PCs[id].peerCon.connectionState)){
                    return //end of listening("0" means host with that id no longer exists)
                }
                listen() //its async so we can call it anywhere inside
                if(err) return
                candidate = JSON.parse(candidate)
                try {
                    await INST.PCs[id].peerCon.addIceCandidate(candidate);
                } catch (e) {
                    console.error('Error adding received ice candidate', e);
                }
            })
        }
        listen()
    
        this.PCs[id].peerCon.onconnectionstatechange = event => {
            switch(this.PCs[id].peerCon.connectionState){
                case 'connected':
                    this.dispatchEvent(new CustomEvent("connected", {detail:{id:id}}))
                    break
                case 'disconnected':
                    this.dispatchEvent(new CustomEvent("disconnected", {detail:{id:id}}))
                    break
                case 'failed':
                    this.dispatchEvent(new CustomEvent("failed", {detail:{id:id}}))
                    delete this.PCs[id]
                    break
                case 'closed':
                    this.dispatchEvent(new CustomEvent("closed", {detail:{id:id}}))
                    delete this.PCs[cId]
                    break
            }
        };
        this.PCs[id].peerCon.onicecandidate = event => {
            if (event.candidate)    //we're sending candidate to host
                POST(this.url.connect, JSON.stringify({id: id, iceCandidate: event.candidate}), ()=>{});
        };
        this.PCs[id].peerCon.ondatachannel = function(event) {
            INST.handleChannel(event.channel, id)
        }
    }
    close(id){
        if(this.PCs[id]){
            if(this.PCs[id].channels["system"].readyState === "open")
                this.PCs[id].channels["system"].send("close")
            this.PCs[id].peerCon.close()
            delete this.PCs[id]
            this.dispatchEvent(new CustomEvent("closed", {detail: {desc: "forced close", id: id}}))
        }
    }
    closeAll(){
        for(var id in this.PCs)
            this.close(id)
    }
    message(id, label, data){
        if(this.PCs[id].channels["message"].readyState === "open")
            this.PCs[id].channels["message"].send(JSON.stringify({label:label, data:data}))
        else{
            if(!this.PCs[id].channels["message"].pending)
                this.PCs[id].channels["message"].pending = []
            this.PCs[id].channels["message"].pending.push(JSON.stringify({label:label, data:data}))
        }
    }
}