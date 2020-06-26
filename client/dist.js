if(URLh && (URLh[URLh.length-1] !== "/" || URLh[URLh.length-1] !== "\\"))
    URLh+="/"

function GET(URL,callback){
    var req = new XMLHttpRequest()
    req.open('GET', URL, true)
    req.onreadystatechange = function (evt) {
        if (req.readyState == 4) {
            if(req.status == 200)
                callback(req.responseText)
        }
    };
    req.send(null); 
}
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
function newID() {
    return Math.random().toString(36).substr(2, 9)+"_"+Math.random().toString(36).substr(2, 9);
};


const configuration = {'iceServers': [{'urls': 'stun:stun.l.google.com:19302'}]}
var PCs = {}

function createChannels(pc, chs){
    if(!Array.isArray(chs)) chs = [chs]
    for(ch of chs){
        var channel = pc.createDataChannel(ch.name);
        channel.onopen = ch.onopen
        channel.onmessage = ch.onmessage
        channel.onclose = ch.onclose
    }
}

async function host(opts){
    if(!opts.URL) opts.URL = URLh+"host"
    const peerConnection = new RTCPeerConnection(configuration)
    createChannels(peerConnection, opts.chs)

    async function listen(){
        POST(opts.URL,JSON.stringify({listener: true, id: opts.ID}), async (data,err)=>{
            if(peerConnection.connectionState==="connected" || peerConnection.connectionState === "failed") {
                host(opts)
                return
            }
            if(data === "0"){
                delete opts.ID
                host(opts)
                return
            }
            listen()
            if(err) return

            data = JSON.parse(data)
            if(!!data.offer){
                peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer))
                const answer = await peerConnection.createAnswer()
                await peerConnection.setLocalDescription(answer)
                POST(opts.URL, JSON.stringify({id: opts.ID, answer: answer}), ()=>{})
            }
            if(!!data.iceCandidate){
                try {
                    await peerConnection.addIceCandidate(data.iceCandidate);
                } catch (e) {
                    console.error('Error adding received ice candidate', e);
                }
            }
        })
    }
    if(!opts.ID){
        POST(opts.URL, JSON.stringify({getId: true}), (id, err)=>{
            if(err) {
                if(opts.onErr) opts.onErr(err)
                return
            }
            opts.ID = id
            console.log(opts)
            if(opts.onId) opts.onId(id)
            listen()
        })
    }else{
        listen()
    }

    const cId = newID()
    peerConnection.onconnectionstatechange = event => {
        if (peerConnection.connectionState === 'connected')
            PCs[cId] = {id: cId, PC: peerConnection}
        if(peerConnection.connectionState === 'disconnected')
            delete PCs[cId]
    }   ;
    peerConnection.onicecandidate = event => {
        if (event.candidate)
            POST(opts.URL, JSON.stringify({id: opts.ID, iceCandidate: event.candidate}), ()=>{});
    };

    peerConnection.ondatachannel = function(event) {
        var channel = event.channel;
        channel.onmessage = function(event) {
            if(opts.ondata) opts.ondata(channel.label, event.data)
        }
    }
}
async function connect(opts){
    if(!opts.URL) opts.URL = URLh+"connect"
    const peerConnection = new RTCPeerConnection(configuration)
    createChannels(peerConnection, opts.chs)
    const offer = await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer)

    POST(opts.URL, JSON.stringify({id: id, offer:offer}) , async data=>{
        data = JSON.parse(data)
        const remoteDesc = new RTCSessionDescription(data.answer)
        await peerConnection.setRemoteDescription(remoteDesc)
    })
    function listen(){
        POST(opts.URL, JSON.stringify({id: id, iceListener: true}) , async (data, err)=>{
            if(data === "0") return;
            listen()
            if(err) return
            data = JSON.parse(data)
            try {
                await peerConnection.addIceCandidate(data);
            } catch (e) {
                console.error('Error adding received ice candidate', e);
            }
        })
    }
    listen()

    peerConnection.onconnectionstatechange = event => {
        if (peerConnection.connectionState === 'connected'){
            PCs[id] = {id: id, PC: peerConnection}
            if(opts.onConnect) opts.onConnect()
        }
        if(peerConnection.connectionState === 'disconnected'){
            delete PCs[id]
            if(opts.onDisconnect) opts.onDisconnect()
        }
        if(peerConnection.connectionState === 'failed')
            if(opts.onFailed) opts.onFailed()
        console.log(PCs)
    };
    peerConnection.onicecandidate = event => {
        if (event.candidate)
            POST(opts.URL, JSON.stringify({id: id, iceCandidate: event.candidate}), ()=>{});
    };
    
    peerConnection.ondatachannel = function(event) {
        var channel = event.channel;
        channel.onmessage = function(event) {
            if(opts.ondata) opts.ondata(channel.label, event.data)
        }
    }
}
function close(id){ //returns if peer with given id was found
    if(PCs[id]){
        PCs[id].PC.close()
        delete PCs[id]
        return true
    }else
        return false
}
function closeAll(){
    for(id in PCs)
        close(id)
}