use anyhow::Result;
use clap::{Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

mod ci;
mod config;
mod doctor;
mod packs;
mod runner;
mod store;

#[derive(Parser)]
#[command(name = "elegy-checks")]
#[command(about = "Local check registry, runner, and evidence store for Elegy Copilot.")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Init {
        #[arg(long)]
        repo: PathBuf,
        #[arg(long)]
        import_copilot: bool,
    },
    Validate {
        #[arg(long)]
        repo: PathBuf,
        #[arg(long)]
        json: bool,
    },
    Migrate {
        #[arg(long)]
        repo: PathBuf,
        #[arg(long)]
        json: bool,
    },
    Discover {
        #[arg(long)]
        repo: PathBuf,
        #[arg(long)]
        json: bool,
    },
    Register {
        #[arg(long)]
        repo: PathBuf,
        #[arg(long)]
        check: String,
        #[arg(long)]
        command: String,
        #[arg(long)]
        profile: String,
    },
    Run {
        #[arg(long)]
        repo: PathBuf,
        #[arg(long)]
        profile: Option<String>,
        #[arg(long)]
        check: Option<String>,
        #[arg(long)]
        json: bool,
    },
    State {
        #[arg(long)]
        repo: PathBuf,
        #[arg(long)]
        json: bool,
    },
    Logs {
        #[arg(long)]
        repo: PathBuf,
        #[arg(long)]
        run_id: String,
        #[arg(long)]
        check: Option<String>,
        #[arg(long)]
        limit: Option<i64>,
        #[arg(long)]
        offset: Option<i64>,
        #[arg(long)]
        json: bool,
    },
    CiMap {
        #[arg(long)]
        repo: PathBuf,
        #[arg(long, value_enum)]
        scope: CiScope,
        #[arg(long)]
        json: bool,
    },
    Stats {
        #[arg(long)]
        repo: PathBuf,
        #[arg(long)]
        json: bool,
    },
    History {
        #[arg(long)]
        repo: PathBuf,
        #[arg(long)]
        limit: Option<i64>,
        #[arg(long)]
        offset: Option<i64>,
        #[arg(long)]
        json: bool,
    },
    Doctor {
        #[arg(long)]
        repo: PathBuf,
        #[arg(long)]
        json: bool,
    },
    Audit {
        #[arg(long)]
        repo: PathBuf,
        #[arg(long)]
        json: bool,
    },
    Apply {
        #[arg(long)]
        repo: PathBuf,
        #[arg(long)]
        proposal: Option<String>,
        #[arg(long)]
        all: bool,
        #[arg(long)]
        json: bool,
    },
    Packs {
        #[command(subcommand)]
        command: PacksCommands,
    },
}

#[derive(Subcommand)]
enum PacksCommands {
    List {
        #[arg(long)]
        json: bool,
    },
    Show {
        pack: String,
        #[arg(long)]
        json: bool,
    },
}

#[derive(Clone, ValueEnum)]
enum CiScope {
    Pr,
    MainPush,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Init {
            repo,
            import_copilot,
        } => {
            let result = config::init_repo(&repo, import_copilot)?;
            print_json(&result)
        }
        Commands::Validate { repo, .. } => {
            let result = config::validate_repo(&repo)?;
            print_json(&result)
        }
        Commands::Migrate { repo, .. } => {
            let result = config::migrate_repo(&repo)?;
            print_json(&result)
        }
        Commands::Discover { repo, .. } => {
            let repo = config::normalize_repo(&repo)?;
            let cfg = config::load_config(&repo)?;
            let result = config::discover(&repo, &cfg);
            print_json(&result)
        }
        Commands::Register {
            repo,
            check,
            command,
            profile,
        } => {
            let result = config::register_check(&repo, &check, &command, &profile)?;
            print_json(&result)
        }
        Commands::Run {
            repo,
            profile,
            check,
            ..
        } => {
            let result = runner::run_checks(&repo, profile.as_deref(), check.as_deref())?;
            let exit_code = if result.overall_pass { 0 } else { 1 };
            print_json(&result)?;
            std::process::exit(exit_code);
        }
        Commands::State { repo, .. } => {
            let result = store::read_state(&repo)?;
            print_json(&result)
        }
        Commands::Logs {
            repo,
            run_id,
            check,
            limit,
            offset,
            ..
        } => {
            let result = store::read_logs(&repo, &run_id, check.as_deref(), limit, offset)?;
            print_json(&result)
        }
        Commands::CiMap { repo, scope, .. } => {
            let cfg = config::load_config(&repo)?;
            let scope = match scope {
                CiScope::Pr => ci::Scope::Pr,
                CiScope::MainPush => ci::Scope::MainPush,
            };
            let result = ci::map_ci(&repo, &cfg, scope)?;
            print_json(&result)
        }
        Commands::Stats { repo, .. } => {
            let result = store::read_stats(&repo)?;
            print_json(&result)
        }
        Commands::History {
            repo,
            limit,
            offset,
            ..
        } => {
            let result = store::read_history(&repo, limit, offset)?;
            print_json(&result)
        }
        Commands::Doctor { repo, .. } => {
            let result = doctor::diagnose(&repo)?;
            print_json(&result)
        }
        Commands::Audit { repo, .. } => {
            let result = packs::audit_repo(&repo)?;
            print_json(&result)
        }
        Commands::Apply {
            repo,
            proposal,
            all,
            ..
        } => {
            let result = packs::apply_repo(&repo, proposal.as_deref(), all)?;
            print_json(&result)
        }
        Commands::Packs { command } => match command {
            PacksCommands::List { .. } => {
                let result = packs::list_packs();
                print_json(&result)
            }
            PacksCommands::Show { pack, .. } => {
                let result = packs::show_pack(&pack)?;
                print_json(&result)
            }
        },
    }
}

fn print_json<T: serde::Serialize>(value: &T) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}
