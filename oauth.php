<?php
//  Gitpullinator OAuth Handler

define('CLIENT_ID',     'Ov23lim3qo01CG6Lzsb5');
define('CLIENT_SECRET', 'YOUR_CLIENT_SECRET_HERE');
define('REDIRECT_BACK', 'https://jenstech.qzz.io/gitpullinator/');

$action = $_GET['action'] ?? '';

// browser navigates here, we redirect to GitHub 
if ($action === 'start') {
    $state = bin2hex(random_bytes(16));
    setcookie('oauth_state', $state, time() + 300, '/', '', true, true);
    $params = http_build_query([
        'client_id'    => CLIENT_ID,
        'redirect_uri' => 'https://jenstech.rf.gd/gitpullinator/oauth.php',
        'scope'        => 'repo',
        'state'        => $state,
    ]);
    header('Location: https://github.com/login/oauth/authorize?' . $params);
    exit;
}

// Callback. GitHub sends user back here with ?code= 
$code  = $_GET['code']  ?? '';
$state = $_GET['state'] ?? '';

if (!$code) {
    redirectWithError('No code returned from GitHub');
}

// Validate state to prevent CSRF
$savedState = $_COOKIE['oauth_state'] ?? '';
if (!$savedState || !hash_equals($savedState, $state)) {
    redirectWithError('Invalid state parameter');
}
setcookie('oauth_state', '', time() - 3600, '/'); // clear state cookie

// Exchange code for token via curl 
$ch = curl_init('https://github.com/login/oauth/access_token');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => http_build_query([
        'client_id'     => CLIENT_ID,
        'client_secret' => CLIENT_SECRET,
        'code'          => $code,
        'redirect_uri'  => 'https://jenstech.rf.gd/gitpullinator/oauth.php',
    ]),
    CURLOPT_HTTPHEADER => [
        'Accept: application/json',
        'User-Agent: Gitpullinator',
    ],
]);

$response = curl_exec($ch);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError) {
    redirectWithError('cURL error: ' . $curlError);
}

$data = json_decode($response, true);

if (!empty($data['error'])) {
    redirectWithError($data['error_description'] ?? $data['error']);
}

$token = $data['access_token'] ?? '';
if (!$token) {
    redirectWithError('No token in response');
}

// Send token back to React app via URL fragment 
header('Location: ' . REDIRECT_BACK . '#gh_token=' . urlencode($token));
exit;

//  Helper 
function redirectWithError($msg) {
    header('Location: ' . REDIRECT_BACK . '#gh_error=' . urlencode($msg));
    exit;
}
