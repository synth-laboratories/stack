mod handlers;
mod mcp_sidecar;
mod monitor_scheduler;
mod openapi;
mod runtime;
mod server;
mod victorialogs;

use clap::{Parser, Subcommand};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};

#[derive(Debug, Parser)]
#[command(name = "stackd", about = "Stack local session indexer and exporter")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Subcommand)]
enum Command {
    Serve(ServeArgs),
}

#[derive(Debug, Parser)]
struct ServeArgs {
    #[arg(long, env = "STACK_API_BIND", default_value = "127.0.0.1")]
    bind: IpAddr,
    #[arg(long, env = "STACK_API_PORT", default_value_t = 8792)]
    port: u16,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();
    let command = cli.command.unwrap_or(Command::Serve(ServeArgs {
        bind: IpAddr::V4(Ipv4Addr::LOCALHOST),
        port: 8792,
    }));

    match command {
        Command::Serve(args) => {
            if args.bind == IpAddr::V4(Ipv4Addr::UNSPECIFIED) {
                tracing::warn!(
                    "stackd is binding 0.0.0.0 because STACK_API_BIND or --bind requested it"
                );
            }
            server::serve(SocketAddr::new(args.bind, args.port)).await?;
        }
    }

    Ok(())
}
