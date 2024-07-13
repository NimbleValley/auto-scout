var socket = io();
socket.on('status-update', handleStatusUpdate);

const statusContainer = document.getElementById('status-container');

function handleStatusUpdate(e) {
    let tempStatus = document.createElement('h3');
    tempStatus.innerText = e;
    statusContainer.appendChild(tempStatus);
}