var fs = require('fs')
var express = require('express')


class User {
    constructor(id) {
        this.id = id
        this.pending = {}
        this.sendAnswer = {}
        this.sendIce = {}
        this.iceCandidate = {}
    }
}

function newID() {
    return Math.random().toString(36).substr(2, 9)+"_"+Math.random().toString(36).substr(2, 9);
};

_clientCode = fs.readFileSync('./client/script.js', (err) => {
    if (err) throw err
}).toString()

module.exports = ()=>{
    var users = {}
    function host(data, send){
        if(data.getId){
            const id = newID()
            users[id] = new User(id) 
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
            if(data.paused){
                for(var cId in users[data.id].sendAnswer){
                    users[data.id].sendAnswer[cId](data)
                    delete users[data.id].sendAnswer[cId]
                }
                send("1")
                users[data.id].paused = true
                return
            }else
                users[data.id].paused = false
            if(data.listener){
                delete users[data.id].send
                if(Object.keys(users[data.id].pending).length === 0)
                    users[data.id].send = send
                else{
                    send(users[data.id].pending)
                    users[data.id].pending = {}
                }
            }
            if(data.answer){
                users[data.id].sendAnswer[data.cId](data)
                delete users[data.id].sendAnswer[data.cId]
                send("1")
            }
            if(data.iceCandidate){
                if(users[data.id].sendIce[data.cId]){
                    users[data.id].sendIce[data.cId](data.iceCandidate)
                    delete users[data.id].sendIce[data.cId]
                }else
                    users[data.id].iceCandidate[data.cId] = data.iceCandidate
            }
            return
        }else{
            send("0")
        }
    }
    function connect (data, send){
        if(users[data.id]){
            if(users[data.id].paused){
                send("0")
                return
            }
            if(data.iceListener){
                if(!data.cId){
                    send("-1")
                    return
                } 
                if(users[data.id].iceCandidate[data.cId]){
                    send(users[data.id].iceCandidate[data.cId])
                    delete users[data.id].iceCandidate[data.cId]
                }else
                    users[data.id].sendIce[data.cId] = send
            }else{
                if(!data.cId){
                    send("-1")
                    return
                } 
                if(users[data.id].send){
                    users[data.id].send({[data.cId]: data})
                    delete users[data.id].send
                }else{
                    users[data.id].pending[data.cId] = data
                }
                if(data.offer){
                    users[data.id].sendAnswer[data.cId] = send;
                }else
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