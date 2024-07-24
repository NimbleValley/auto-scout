export var socket = io();
socket.on('status-update', handleStatusUpdate);

const statusContainer = document.getElementById('status-container');

function handleStatusUpdate(e) {
    let tempStatus = document.createElement('h4');
    tempStatus.innerText = e;
    console.log(e);
    statusContainer.appendChild(tempStatus);
}