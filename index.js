var fs = require('fs')
var express = require('express')


class User {
    constructor(id) {
        this.id = id
        this.pending = {}
    }
}

function newID() {
    return Math.random().toString(36).substr(2, 9)+"_"+Math.random().toString(36).substr(2, 9);
};

_clientCode = fs.readFileSync('./client/dist.js', (err) => {
    if (err) throw err
}).toString()

module.exports = ()=>{
    var users = {}
    function host(data, send){
        if(data.getId){
            const id = newID()
            users[id] = new User(id)   //TODO delete them if unavailable
            const interv = setInterval(()=>{
                if(!users[id]){
                    clearInterval(interv)
                    return
                }
                if(new Date().getTime() - users[id].lastPing > 15000){
                    clearInterval(interv)
                    delete users[id]
                    return
                }
            })
            send(id)
            return
        }
        if(users[data.id]){
            users[data.id].lastPing = new Date().getTime()
            if(data.listener)
                if(users[data.id].offer){
                    send(users[data.id])
                    delete users[data.id]
                }else
                    users[data.id].send = send
            if(data.answer){
                users[data.id].sendAnswer(data)
                delete users[data.id].sendAnswer
                send("1")
            }
            if(data.iceCandidate){
                if(users[data.id].sendIce){
                    users[data.id].sendIce(data.iceCandidate)
                    delete users[data.id].sendIce
                }else
                    users[data.id].sIceCandidate = data.iceCandidate
            }
            return
        }else{
            send("0")
        }
    }
    function connect (data, send){
        if(users[data.id]){
            if(data.iceListener){
                if(users[data.id].sIceCandidate){
                    send(users[data.id].sIceCandidate)
                    delete users[data.id].sIceCandidate
                }else
                    users[data.id].sendIce = send
            }else{
                if(users[data.id].send){
                    users[data.id].send(data)
                    delete users[data.id].send
                }else{
                    users[data.id].offer = data.offer
                    users[data.id].iceCandidate = data.iceCandidate
                }
                if(data.offer)
                    users[data.id].sendAnswer = send;
                else
                    send("1")
            }
        }else
            send("0")
    }
    return {
        host: host,
        connect: connect,
        usersList: ()=>{
            return Object.keys(users)
        },
        getUser: (id)=>{
            return users[id]
        },
        _clientCode: _clientCode,
        _router: ()=>{
            var router = express.Router()
            router.get('/', (req, res)=>{
                res.send("var URLh='"+req.originalUrl+"';"+_clientCode)
            })
            router.post('/host', (req,res) =>{
                host(req.body, resp=>res.send(resp))
            })
            router.post('/connect', (req,res) =>{
                connect(req.body, resp=>res.send(resp))
            })
            return router
        }
    }
}