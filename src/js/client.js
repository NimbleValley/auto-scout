console.log("Hi.");

const youtubeSubmitButton = document.getElementById('youtube-link-submit');

youtubeSubmitButton.addEventListener('click', function() {
    let newWindow = window.open('http://localhost:8080/download');
    newWindow.close();
});