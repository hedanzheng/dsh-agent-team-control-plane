[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$BaseUrl = 'http://127.0.0.1:8811',

    [Parameter()]
    [string]$OutputPath,

    [Parameter()]
    [ValidateRange(1024, 1048576)]
    [int]$MaxBodyInspectionBytes = 65536,

    [Parameter()]
    [ValidateRange(1, 120)]
    [int]$TimeoutSeconds = 15
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$artifactName = 'agent-team-control-plane-r0-http-boundary'
$route = '/agent-team-control-plane/v1'
$unknownAction = '__r0_probe_unknown_action_v1__'

function Resolve-LocalBaseOrigin {
    param([Parameter(Mandatory = $true)][string]$Value)

    try {
        $uri = [System.Uri]::new($Value, [System.UriKind]::Absolute)
    }
    catch {
        throw 'BaseUrl must be an absolute HTTP(S) URL.'
    }

    if ($uri.Scheme -notin @('http', 'https')) {
        throw 'BaseUrl must use HTTP or HTTPS.'
    }
    $allowedHosts = @('localhost', '127.0.0.1', '[::1]')
    if ($uri.Host.ToLowerInvariant() -notin $allowedHosts) {
        throw 'R0 boundary probes are restricted to localhost, 127.0.0.1, or [::1].'
    }
    if (-not [string]::IsNullOrEmpty($uri.UserInfo)) {
        throw 'BaseUrl must not contain user information.'
    }
    if (-not [string]::IsNullOrEmpty($uri.Query) -or -not [string]::IsNullOrEmpty($uri.Fragment)) {
        throw 'BaseUrl must not contain a query string or fragment.'
    }
    if ($uri.AbsolutePath -ne '/') {
        throw 'BaseUrl must be an origin without a path.'
    }

    return $uri.GetLeftPart([System.UriPartial]::Authority).TrimEnd('/')
}

function Test-HeaderPresent {
    param(
        [Parameter(Mandatory = $true)]$Response,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $values = [System.Collections.Generic.IEnumerable[string]]$null
    if ($Response.Headers.TryGetValues($Name, [ref]$values)) {
        return $true
    }
    if ($null -ne $Response.Content -and $Response.Content.Headers.TryGetValues($Name, [ref]$values)) {
        return $true
    }
    return $false
}

function Get-SafeHeaderValue {
    param(
        [Parameter(Mandatory = $true)]$Response,
        [Parameter(Mandatory = $true)][string]$Name
    )

    # Only callers for the small, non-credential CORS/content allowlist below use this helper.
    $values = [System.Collections.Generic.IEnumerable[string]]$null
    if ($Response.Headers.TryGetValues($Name, [ref]$values)) {
        return (($values | ForEach-Object { [string]$_ }) -join ', ')
    }
    if ($null -ne $Response.Content -and $Response.Content.Headers.TryGetValues($Name, [ref]$values)) {
        return (($values | ForEach-Object { [string]$_ }) -join ', ')
    }
    return $null
}

function Read-BodyMetadata {
    param(
        [Parameter(Mandatory = $true)]$Response,
        [Parameter(Mandatory = $true)][int]$Limit
    )

    $stream = $null
    $memory = $null
    try {
        $stream = $Response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $memory = [System.IO.MemoryStream]::new()
        $buffer = [byte[]]::new(8192)
        $totalRead = 0

        while ($totalRead -le $Limit) {
            $remaining = ($Limit + 1) - $totalRead
            if ($remaining -le 0) {
                break
            }
            $readSize = [Math]::Min($buffer.Length, $remaining)
            $count = $stream.Read($buffer, 0, $readSize)
            if ($count -eq 0) {
                break
            }
            $memory.Write($buffer, 0, $count)
            $totalRead += $count
        }

        $truncated = $totalRead -gt $Limit
        $inspectedBytes = [Math]::Min($totalRead, $Limit)
        $format = 'empty'

        if ($inspectedBytes -gt 0) {
            $bytes = $memory.ToArray()
            $text = [System.Text.Encoding]::UTF8.GetString($bytes, 0, $inspectedBytes).TrimStart()
            $mediaType = $null
            if ($null -ne $Response.Content.Headers.ContentType) {
                $mediaType = [string]$Response.Content.Headers.ContentType.MediaType
            }

            if ($text.StartsWith('{')) {
                $format = 'json-object'
            }
            elseif ($text.StartsWith('[')) {
                $format = 'json-array'
            }
            elseif ($null -ne $mediaType -and $mediaType -match '(?i)(?:^|/)json$|\+json$') {
                $format = 'json-scalar'
            }
            else {
                $format = 'non-json'
            }
        }

        return [ordered]@{
            inspectedBytes = $inspectedBytes
            truncated      = $truncated
            format         = $format
        }
    }
    finally {
        if ($null -ne $memory) { $memory.Dispose() }
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

function Get-NetworkErrorCode {
    param([Parameter(Mandatory = $true)]$Exception)

    if ($Exception -is [System.Threading.Tasks.TaskCanceledException] -or
        $Exception -is [System.TimeoutException]) {
        return 'TIMEOUT_OR_CANCELLED'
    }
    if ($Exception -is [System.Net.Http.HttpRequestException]) {
        return 'CONNECTION_FAILED'
    }
    return 'REQUEST_FAILED'
}

function Invoke-BoundaryRequest {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)][System.Uri]$Uri,
        [Parameter(Mandatory = $true)]$Spec,
        [Parameter(Mandatory = $true)][int]$BodyLimit
    )

    $request = $null
    $response = $null
    try {
        $method = [System.Net.Http.HttpMethod]::new([string]$Spec.method)
        $request = [System.Net.Http.HttpRequestMessage]::new($method, $Uri)

        if ($null -ne $Spec.origin) {
            [void]$request.Headers.TryAddWithoutValidation('Origin', [string]$Spec.origin)
        }
        if ($Spec.originRelation -eq 'cross-origin') {
            [void]$request.Headers.TryAddWithoutValidation('Sec-Fetch-Site', 'cross-site')
        }
        if ($Spec.id -eq 'cross-origin-preflight') {
            [void]$request.Headers.TryAddWithoutValidation('Access-Control-Request-Method', 'POST')
            [void]$request.Headers.TryAddWithoutValidation('Access-Control-Request-Headers', 'content-type')
        }
        if ($Spec.id -eq 'unknown-action-post') {
            $request.Content = [System.Net.Http.StringContent]::new(
                ('{"action":"' + $unknownAction + '"}'),
                [System.Text.Encoding]::UTF8,
                'text/plain'
            )
        }

        $response = $Client.SendAsync(
            $request,
            [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead
        ).GetAwaiter().GetResult()

        $contentLength = $null
        if ($null -ne $response.Content.Headers.ContentLength) {
            $contentLength = [long]$response.Content.Headers.ContentLength
        }
        $contentType = $null
        if ($null -ne $response.Content.Headers.ContentType) {
            $contentType = [string]$response.Content.Headers.ContentType.MediaType
        }

        return [ordered]@{
            id      = [string]$Spec.id
            method  = [string]$Spec.method
            context = [string]$Spec.context
            request = [ordered]@{
                originRelation = [string]$Spec.originRelation
                credentialsSent = $false
                bodyClass       = [string]$Spec.bodyClass
            }
            response = [ordered]@{
                networkOk = $true
                status    = [int]$response.StatusCode
                headers   = [ordered]@{
                    contentType                  = $contentType
                    contentLength                = $contentLength
                    accessControlAllowOrigin     = Get-SafeHeaderValue -Response $response -Name 'Access-Control-Allow-Origin'
                    accessControlAllowCredentials = Get-SafeHeaderValue -Response $response -Name 'Access-Control-Allow-Credentials'
                    vary                         = Get-SafeHeaderValue -Response $response -Name 'Vary'
                    setCookiePresent             = Test-HeaderPresent -Response $response -Name 'Set-Cookie'
                    wwwAuthenticatePresent       = Test-HeaderPresent -Response $response -Name 'WWW-Authenticate'
                }
                body      = Read-BodyMetadata -Response $response -Limit $BodyLimit
            }
        }
    }
    catch {
        $exception = $_.Exception
        if ($null -ne $exception.InnerException) {
            $exception = $exception.InnerException
        }
        return [ordered]@{
            id      = [string]$Spec.id
            method  = [string]$Spec.method
            context = [string]$Spec.context
            request = [ordered]@{
                originRelation = [string]$Spec.originRelation
                credentialsSent = $false
                bodyClass       = [string]$Spec.bodyClass
            }
            response = [ordered]@{
                networkOk = $false
                errorCode = Get-NetworkErrorCode -Exception $exception
            }
        }
    }
    finally {
        if ($null -ne $response) { $response.Dispose() }
        if ($null -ne $request) { $request.Dispose() }
    }
}

Add-Type -AssemblyName System.Net.Http

$baseOrigin = Resolve-LocalBaseOrigin -Value $BaseUrl
$endpoint = [System.Uri]::new($baseOrigin + $route)
$baseUri = [System.Uri]::new($baseOrigin)
$crossPort = if ($baseUri.Port -eq 9) { 10 } else { 9 }
$crossOrigin = $baseUri.Scheme + '://127.0.0.1:' + $crossPort

$specs = @(
    [ordered]@{ id = 'unauthenticated-get'; method = 'GET'; context = 'unauthenticated'; origin = $null; originRelation = 'none'; bodyClass = 'none' },
    [ordered]@{ id = 'same-origin-unauthenticated-get'; method = 'GET'; context = 'same-origin-unauthenticated'; origin = $baseOrigin; originRelation = 'same-origin'; bodyClass = 'none' },
    [ordered]@{ id = 'cross-origin-unauthenticated-get'; method = 'GET'; context = 'cross-origin-unauthenticated'; origin = $crossOrigin; originRelation = 'cross-origin'; bodyClass = 'none' },
    [ordered]@{ id = 'cross-origin-preflight'; method = 'OPTIONS'; context = 'cross-origin-preflight'; origin = $crossOrigin; originRelation = 'cross-origin'; bodyClass = 'none' },
    [ordered]@{ id = 'unknown-action-post'; method = 'POST'; context = 'cross-origin-simple-post'; origin = $crossOrigin; originRelation = 'cross-origin'; bodyClass = 'fixed-unknown-action' }
)

$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$handler.UseCookies = $false
$handler.UseDefaultCredentials = $false
$handler.PreAuthenticate = $false
$handler.UseProxy = $false

$client = [System.Net.Http.HttpClient]::new($handler, $true)
$client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
[void]$client.DefaultRequestHeaders.UserAgent.TryParseAdd('agent-team-control-plane-r0-probe/1')

try {
    $results = @()
    foreach ($spec in $specs) {
        $results += Invoke-BoundaryRequest -Client $client -Uri $endpoint -Spec $spec -BodyLimit $MaxBodyInspectionBytes
    }
}
finally {
    $client.Dispose()
}

$networkSuccessCount = @($results | Where-Object { $_.response.networkOk }).Count
$probeStatus = 'PARTIAL'
if ($networkSuccessCount -eq $results.Count) {
    $probeStatus = 'COMPLETE'
}
elseif ($networkSuccessCount -eq 0) {
    $probeStatus = 'NETWORK_UNAVAILABLE'
}

$evidence = [ordered]@{
    schemaVersion = 1
    artifact      = $artifactName
    capturedAt   = [DateTimeOffset]::UtcNow.ToString('o')
    probeStatus  = $probeStatus
    probe         = [ordered]@{
        baseOrigin = $baseOrigin
        route      = $route
        safeguards = [ordered]@{
            credentialsSent          = $false
            requestBodiesPersisted   = $false
            responseBodiesPersisted  = $false
            maxBodyInspectionBytes   = $MaxBodyInspectionBytes
            noSideEffectPostAction   = $unknownAction
        }
    }
    requests      = $results
}

$json = $evidence | ConvertTo-Json -Depth 12
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::WriteLine($json)
}
else {
    $absoluteOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
    $parent = [System.IO.Path]::GetDirectoryName($absoluteOutputPath)
    if (-not [string]::IsNullOrWhiteSpace($parent)) {
        [System.IO.Directory]::CreateDirectory($parent) | Out-Null
    }
    $temporaryPath = $absoluteOutputPath + '.tmp-' + [Guid]::NewGuid().ToString('N')
    try {
        [System.IO.File]::WriteAllText(
            $temporaryPath,
            $json + [Environment]::NewLine,
            [System.Text.UTF8Encoding]::new($false)
        )
        Move-Item -LiteralPath $temporaryPath -Destination $absoluteOutputPath -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}
