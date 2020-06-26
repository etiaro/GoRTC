const goRTC = require("../index.js")()

const path = require('path')
const express = require('express')
const app = express()
const port = 3000

app.use(express.json());
 
app.use(express.static(path.join(__dirname, 'test_static')))

app.use('/goRTC/', goRTC._router())

app.get('/goRTC/list', (req,res) =>{
    return res.send(goRTC.usersList())
})
app.get('/goRTC/user/:id', (req,res) =>{
    return res.send(goRTC.getUser(req.params.id))
})

app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`)
})