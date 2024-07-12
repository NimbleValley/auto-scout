const http = require('http');
const express = require('express');
const path = require('path');

const fs = require('fs');
const bodyParser = require('body-parser');

// Youtube downloading not working, come back to later
const youtubedl = require('youtube-dl-exec');

const PORT = 8080;
const app = express();

app.use(bodyParser.json({
    limit: '500mb'
}));

app.use(bodyParser.urlencoded({
    limit: '500mb',
    parameterLimit: 100000,
    extended: true
}));

// Index html page
app.use('/index', function (req, res) {
    res.sendFile(path.join(__dirname + '/index.html'));
});

// Send js file over as well
app.use('/js/client.js', function (req, res) {
    res.sendFile(path.join(__dirname + '/js/client.js'));
});

// And styles
app.use('/styles.css', function (req, res) {
    res.sendFile(path.join(__dirname + '/styles.css'));
});

app.get("/download", function (req, res) {
    console.log("Ok.");

    youtubedl('https://www.youtube.com/watch?v=w4zGKuErM6g&t=150s', {
        dumpSingleJson: true,
        noCheckCertificates: true,
        noWarnings: true,
        preferFreeFormats: true,
        addHeader: ['referer:youtube.com', 'user-agent:googlebot']
    }).then(output => console.log(output))

    res.end(JSON.stringify({ "recieved": "All good" }));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));