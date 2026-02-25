use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerLocation {
    pub code: String,
    pub desc: String,
    pub ip: String,
    pub port: u16,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ContinentData {
    pub name: String,
    pub total: usize,
    pub blocked: usize,
    pub countries: Vec<CountryData>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CountryData {
    pub name: String,
    pub flag: String,
    pub total: usize,
    pub blocked: usize,
    pub servers: Vec<ServerLocation>,
}

#[tauri::command]
fn fetch_server_locations() -> Result<Vec<ServerLocation>, String> {
    let url = "https://raw.githubusercontent.com/ValvePython/csgo-sdk/master/csgo/sdkconfig.json";
    let response = reqwest::blocking::get(url).map_err(|e| format!("Failed: {}", e))?;
    let data: serde_json::Value = response.json().map_err(|e| format!("Parse error: {}", e))?;
    let relays = data.get("relay_networks").and_then(|v| v.as_array()).ok_or("No relays")?;
    
    let servers: Vec<ServerLocation> = relays.iter().filter_map(|relay| {
        let code = relay.get("code")?.as_str()?.to_string();
        let desc = relay.get("description")?.as_str()?.to_string();
        let address = relay.get("address")?.as_str()?;
        let (ip, port) = parse_address(address);
        Some(ServerLocation { code, desc, ip, port })
    }).collect();
    
    Ok(servers)
}

fn parse_address(addr: &str) -> (String, u16) {
    let parts: Vec<&str> = addr.split(':').collect();
    let ip = parts.first().unwrap_or(&"").to_string();
    let port = parts.get(1).and_then(|p| p.parse().ok()).unwrap_or(27015);
    (ip, port)
}

const RULE_PREFIX: &str = "CS2_Block";

#[tauri::command]
fn is_admin() -> bool {
    #[cfg(windows)]
    { Command::new("net").args(["session"]).output().map(|o| o.status.success()).unwrap_or(false) }
    #[cfg(not(windows))]
    { false }
}

#[tauri::command]
fn block_servers(servers: Vec<ServerLocation>) -> Result<(), String> {
    for server in servers {
        let rule = format!("{}_{}", RULE_PREFIX, server.code);
        let _ = Command::new("netsh").args(["advfirewall", "firewall", "add", "rule", &format!("name={}", rule), "dir=in", "action=block", &format!("remoteip={}", server.ip), "protocol=any"]).output();
    }
    Ok(())
}

#[tauri::command]
fn unblock_servers(servers: Vec<ServerLocation>) -> Result<(), String> {
    for server in servers {
        let rule = format!("{}_{}", RULE_PREFIX, server.code);
        let _ = Command::new("netsh").args(["advfirewall", "firewall", "delete", "rule", &format!("name={}", rule)]).output();
    }
    Ok(())
}

#[tauri::command]
fn get_blocked_servers() -> Result<HashSet<String>, String> {
    let out = Command::new("netsh").args(["advfirewall", "firewall", "show", "rule", "name=all"]).output().map_err(|e| e.to_string())?;
    let mut blocked = HashSet::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        if line.trim().starts_with("Rule Name:") {
            let name = line.split(':').nth(1).unwrap_or("").trim();
            if name.starts_with(RULE_PREFIX) {
                if let Some(code) = name.strip_prefix(RULE_PREFIX) {
                    let code = code.trim().to_string();
                    if !code.is_empty() { blocked.insert(code); }
                }
            }
        }
    }
    Ok(blocked)
}

#[tauri::command]
fn block_all_in_country(servers: Vec<ServerLocation>) -> Result<(), String> { block_servers(servers) }
#[tauri::command]
fn unblock_all_in_country(servers: Vec<ServerLocation>) -> Result<(), String> { unblock_servers(servers) }

#[tauri::command]
fn unblock_all() -> Result<(), String> {
    let blocked = get_blocked_servers()?;
    for code in blocked {
        let rule = format!("{}_{}", RULE_PREFIX, code);
        let _ = Command::new("netsh").args(["advfirewall", "firewall", "delete", "rule", &format!("name={}", rule)]).output();
    }
    Ok(())
}

#[tauri::command]
fn relaunch_as_admin() -> Result<(), String> {
    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let s = exe.to_string_lossy().replace('\'', "''");
        Command::new("powershell").args(["-Command", &format!("Start-Process '{}' -Verb RunAs", s)]).spawn().map_err(|e| e.to_string())?;
        std::process::exit(0);
    }
    #[cfg(not(windows))] { Err("Not supported".into()) }
}

fn infer_country(desc: &str) -> String {
    let t = desc.trim();
    if t.is_empty() { return "Unknown".into(); }
    if let Some(s) = t.find('(') {
        if let Some(e) = t.find(')') { if e > s { return normalize(&t[s+1..e]); } }
    }
    if let Some(p) = t.split(',').last() { let p = p.trim(); if !p.is_empty() { return normalize(p); } }
    "Unknown".into()
}

fn normalize(s: &str) -> String {
    let lower = s.replace('_', " ").split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    match lower.as_str() {
        "us"|"usa"|"u.s"|"united states" => "United States".to_string(),
        "uk"|"england"|"britain"|"great britain" => "United Kingdom".to_string(),
        "uae" => "United Arab Emirates".to_string(),
        _ => {
            s.replace('_', " ").split_whitespace().map(|w| {
                let mut c = w.chars();
                match c.next() { Some(f) => format!("{}{}", f.to_uppercase(), c.as_str().to_lowercase()), None => "".into() }
            }).collect::<Vec<_>>().join(" ")
        }
    }
}

fn continent(c: &str) -> &'static str {
    match c.to_lowercase().as_str() {
        "argentina"|"brazil"|"chile"|"peru"|"colombia"|"ecuador"|"uruguay" => "South America",
        "australia"|"new zealand" => "Oceania",
        "south africa"|"morocco"|"egypt"|"kenya"|"nigeria" => "Africa",
        "austria"|"belgium"|"czech republic"|"denmark"|"finland"|"france"|"germany"|"greece"|"hungary"|"ireland"|"italy"|"netherlands"|"norway"|"poland"|"portugal"|"romania"|"spain"|"sweden"|"switzerland"|"ukraine"|"united kingdom"|"turkey" => "Europe",
        "china"|"hong kong"|"india"|"indonesia"|"israel"|"japan"|"malaysia"|"pakistan"|"philippines"|"saudi arabia"|"singapore"|"south korea"|"taiwan"|"thailand"|"united arab emirates"|"vietnam" => "Asia",
        "canada"|"mexico"|"united states" => "North America",
        _ => "Unknown",
    }
}

fn flag(c: &str) -> String {
    match c.to_lowercase().as_str() {
        "argentina" => "🇦🇷", "australia" => "🇦🇺", "austria" => "🇦🇹", "belgium" => "🇧🇪",
        "brazil" => "🇧🇷", "canada" => "🇨🇦", "chile" => "🇨🇱", "china" => "🇨🇳",
        "colombia" => "🇨🇴", "czech republic" => "🇨🇿", "denmark" => "🇩🇰", "egypt" => "🇪🇬",
        "finland" => "🇫🇮", "france" => "🇫🇷", "germany" => "🇩🇪", "hong kong" => "🇭🇰",
        "hungary" => "🇭🇺", "india" => "🇮🇳", "indonesia" => "🇮🇩", "ireland" => "🇮🇪",
        "israel" => "🇮🇱", "italy" => "🇮🇹", "japan" => "🇯🇵", "kenya" => "🇰🇪",
        "south korea" => "🇰🇷", "malaysia" => "🇲🇾", "mexico" => "🇲🇽", "morocco" => "🇲🇦",
        "netherlands" => "🇳🇱", "new zealand" => "🇳🇿", "nigeria" => "🇳🇬", "norway" => "🇳🇴",
        "pakistan" => "🇵🇰", "peru" => "🇵🇪", "philippines" => "🇵🇭", "poland" => "🇵🇱",
        "portugal" => "🇵🇹", "romania" => "🇷🇴", "russia" => "🇷🇺", "saudi arabia" => "🇸🇦",
        "singapore" => "🇸🇬", "south africa" => "🇿🇦", "spain" => "🇪🇸", "sweden" => "🇸🇪",
        "switzerland" => "🇨🇭", "taiwan" => "🇹🇼", "thailand" => "🇹🇭", "turkey" => "🇹🇷",
        "ukraine" => "🇺🇦", "united arab emirates" => "🇦🇪", "united kingdom" => "🇬🇧",
        "united states" => "🇺🇸", "vietnam" => "🇻🇳", _ => "🌍",
    }.to_string()
}

const ORDER: [&str;7] = ["North America","South America","Europe","Asia","Africa","Oceania","Unknown"];

#[tauri::command]
fn get_country_data(servers: Vec<ServerLocation>, blocked: HashSet<String>) -> Vec<ContinentData> {
    let mut stats: HashMap<String,(usize,usize)> = HashMap::new();
    for s in &servers {
        let c = infer_country(&s.desc);
        let e = stats.entry(c).or_insert((0,0));
        e.0 += 1; if blocked.contains(&s.code) { e.1 += 1; }
    }
    let mut map: HashMap<&str,Vec<CountryData>> = HashMap::new();
    for (c,(t,b)) in &stats {
        let cont = continent(c);
        let sv: Vec<ServerLocation> = servers.iter().filter(|s| infer_country(&s.desc)==*c).cloned().collect();
        map.entry(cont).or_default().push(CountryData { name:c.clone(), flag:flag(c), total:*t, blocked:*b, servers:sv });
    }
    for v in map.values_mut() { v.sort_by(|a,b| b.blocked.cmp(&a.blocked).then(a.name.cmp(&b.name))); }
    ORDER.iter().filter_map(|n| map.get(*n).map(|v| {
        let tt: usize = v.iter().map(|c|c.total).sum();
        let bb: usize = v.iter().map(|c|c.blocked).sum();
        ContinentData { name:n.to_string(), total:tt, blocked:bb, countries:v.clone() }
    })).collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default().plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![fetch_server_locations,is_admin,block_servers,unblock_servers,get_blocked_servers,block_all_in_country,unblock_all_in_country,unblock_all,relaunch_as_admin,get_country_data])
        .run(tauri::generate_context!()).expect("error");
}

fn main() { run(); }
