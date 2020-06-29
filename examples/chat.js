const goRTC = require("../index.js")()

const path = require('path')
const express = require('express')
const app = express()
const port = 3000
 

app.use(express.json());

app.get('/goRTC/list', (req,res) =>{
    return res.send(goRTC.usersList())
})
app.get('/goRTC/user/:id', (req,res) =>{
    return res.send(goRTC.getUser(req.params.id))
})

app.post('/goRTC/abc', (req,res) =>{
    return
})

app.use('/goRTC/', goRTC._router)
app.use(express.static(path.join(__dirname, 'chat_static')))

app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`)
})